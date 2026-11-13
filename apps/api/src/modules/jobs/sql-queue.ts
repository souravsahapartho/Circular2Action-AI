import { randomUUID } from 'node:crypto';
import { isRetryable, type Db, type Executor, type Row } from '../../db/pool';
import { BACKOFF_MS, type JobStatus } from './queue';

/**
 * SQL job store for TiDB (plan section 9.7, DBC-04). TiDB has no `SELECT ... FOR UPDATE SKIP LOCKED`, so a claim
 * is a single `UPDATE ... ORDER BY ... LIMIT` that stamps a per-claim token into `locked_by`; the claimed rows are
 * then read back by that token. Every later state change is fenced on (id, token, status = 'running'), so a
 * worker that lost its lease can no longer complete, fail or release the job.
 * Time comes from the database (`NOW(3)`), never from the application clock.
 */
export interface SqlJob {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  token: string;
}

export interface EnqueueInput {
  type: string;
  payload: unknown;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

export const LEASE_SECONDS = 180;
/** Candidate window = limit x factor; wider windows spread contention between workers. */
export const CLAIM_WINDOW_FACTOR = 8;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// TiDB rejects `INTERVAL (expr) SECOND`; the backoff is computed with CASE and applied through TIMESTAMPADD.
const backoffCase = `CASE ${BACKOFF_MS.map((ms, i) => `WHEN attempts <= ${i + 1} THEN ${ms / 1000}`).join(' ')} ELSE ${BACKOFF_MS[BACKOFF_MS.length - 1]! / 1000} END`;

export class SqlJobStore {
  constructor(private readonly db: Db) {}

  /** Returns the new id, or null when `dedupeKey` already exists. */
  async enqueue(input: EnqueueInput, tx: Executor = this.db): Promise<string | null> {
    try {
      const res = await tx.execute(
        `INSERT INTO background_jobs (type, payload, priority, run_at, max_attempts, dedupe_key)
         VALUES (:type, :payload, :priority, COALESCE(:runAt, NOW(3)), :maxAttempts, :dedupeKey)`,
        {
          type: input.type,
          payload: JSON.stringify(input.payload ?? {}),
          priority: input.priority ?? 5,
          runAt: input.runAt ?? null,
          maxAttempts: input.maxAttempts ?? 5,
          dedupeKey: input.dedupeKey ?? null,
        },
      );
      return String(res.insertId);
    } catch (err) {
      if ((err as { errno?: number }).errno === 1062) return null;
      throw err;
    }
  }

  /**
   * Two-step claim (ADR-022). Step 1 reads a window of candidate ids without locking; step 2 claims a random
   * subset with a conditional UPDATE by primary key that re-checks claimability, so two workers can never both
   * win a row. On TiDB v8.5.3 the plan's single `UPDATE ... ORDER BY ... LIMIT` hit "pessimistic lock retry
   * limit reached" with 20 workers contending for the same top rows (gate S-3 evidence).
   */
  async claim(workerId: string, limit: number): Promise<SqlJob[]> {
    const token = `${workerId.slice(0, 40)}:${randomUUID().slice(0, 12)}`;
    const candidates = await this.db.query<Row & { id: string }>(
      `SELECT id FROM background_jobs
       WHERE run_at <= NOW(3) AND attempts < max_attempts
         AND ( status IN ('queued','retry') OR (status = 'running' AND locked_until < NOW(3)) )
       ORDER BY priority, run_at
       LIMIT :window`,
      { window: limit * CLAIM_WINDOW_FACTOR },
    );
    if (candidates.length === 0) return [];
    const ids = shuffle(candidates.map((c) => String(c.id))).slice(0, limit);
    let affected = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.db.execute(
          `UPDATE background_jobs
           SET status = 'running', locked_by = :token,
               locked_until = NOW(3) + INTERVAL ${LEASE_SECONDS} SECOND,
               heartbeat_at = NOW(3), attempts = attempts + 1
           WHERE id IN (:ids)
             AND run_at <= NOW(3) AND attempts < max_attempts
             AND ( status IN ('queued','retry') OR (status = 'running' AND locked_until < NOW(3)) )`,
          { token, ids },
        );
        affected = res.affectedRows;
        break;
      } catch (err) {
        if (attempt < 5 && isRetryable(err)) {
          await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.random() * 10));
          continue;
        }
        throw err;
      }
    }
    if (affected === 0) return [];
    const rows = await this.db.query<
      Row & {
        id: string;
        type: string;
        payload: unknown;
        status: JobStatus;
        priority: number;
        attempts: number;
        max_attempts: number;
      }
    >(
      `SELECT id, type, payload, status, priority, attempts, max_attempts
       FROM background_jobs WHERE id IN (:ids) AND locked_by = :token AND status = 'running'`,
      { token, ids },
    );
    return rows.map((r) => ({
      id: String(r.id),
      type: r.type,
      payload: r.payload,
      status: r.status,
      priority: r.priority,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      token,
    }));
  }

  /** Extends the lease; false means the lease was lost and the handler must stop. */
  async heartbeat(job: Pick<SqlJob, 'id' | 'token'>): Promise<boolean> {
    const res = await this.db.execute(
      `UPDATE background_jobs SET heartbeat_at = NOW(3), locked_until = NOW(3) + INTERVAL ${LEASE_SECONDS} SECOND
       WHERE id = :id AND locked_by = :token AND status = 'running' AND locked_until >= NOW(3)`,
      { id: job.id, token: job.token },
    );
    return res.affectedRows === 1;
  }

  /**
   * Marks the job succeeded. Pass the transaction that performs the job's side effect so the effect and the
   * completion commit together; returns false (and the caller must roll back) if the lease was lost.
   */
  async complete(job: Pick<SqlJob, 'id' | 'token'>, tx: Executor = this.db): Promise<boolean> {
    const res = await tx.execute(
      `UPDATE background_jobs SET status = 'succeeded', locked_by = NULL, locked_until = NULL, finished_at = NOW(3)
       WHERE id = :id AND locked_by = :token AND status = 'running'`,
      { id: job.id, token: job.token },
    );
    return res.affectedRows === 1;
  }

  async fail(job: Pick<SqlJob, 'id' | 'token'>, errorCode: string): Promise<boolean> {
    const res = await this.db.execute(
      `UPDATE background_jobs
       SET last_error_code = :code, locked_by = NULL, locked_until = NULL,
           status = IF(attempts >= max_attempts, 'failed', 'retry'),
           finished_at = IF(attempts >= max_attempts, NOW(3), NULL),
           run_at = IF(attempts >= max_attempts, run_at,
             TIMESTAMPADD(SECOND, ${backoffCase}, NOW(3)))
       WHERE id = :id AND locked_by = :token AND status = 'running'`,
      { id: job.id, token: job.token, code: errorCode.slice(0, 64) },
    );
    return res.affectedRows === 1;
  }

  /** Graceful shutdown (SCH-06): hand the job back without consuming an attempt. */
  async release(job: Pick<SqlJob, 'id' | 'token'>): Promise<boolean> {
    const res = await this.db.execute(
      `UPDATE background_jobs
       SET status = 'retry', locked_by = NULL, locked_until = NULL, attempts = GREATEST(attempts - 1, 0)
       WHERE id = :id AND locked_by = :token AND status = 'running'`,
      { id: job.id, token: job.token },
    );
    return res.affectedRows === 1;
  }

  /** Leases that expired with no attempts left become failed (SCH-09). Returns the number swept. */
  async sweepExhausted(): Promise<number> {
    const res = await this.db.execute(
      `UPDATE background_jobs
       SET status = 'failed', last_error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS', locked_by = NULL, locked_until = NULL,
           finished_at = NOW(3)
       WHERE status = 'running' AND locked_until < NOW(3) AND attempts >= max_attempts`,
    );
    return res.affectedRows;
  }
}
