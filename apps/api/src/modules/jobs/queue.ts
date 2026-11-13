/**
 * Job queue semantics (plan section 9.7, JOB-1, SCH-04 to SCH-09).
 * InMemoryJobStore mirrors the SQL claim statement so the behaviour can be tested without a database;
 * the SQL version is validated under concurrency in gates S-3 and S-6.
 */
export type JobStatus = 'queued' | 'running' | 'retry' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: number;
  type: string;
  payload: unknown;
  status: JobStatus;
  priority: number;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedUntil: Date | null;
  heartbeatAt: Date | null;
  dedupeKey: string | null;
  lastErrorCode: string | null;
}

/** The claim statement from the plan, kept as a constant for the SQL repository and for review. */
export const CLAIM_SQL = `UPDATE background_jobs
SET status = 'running', locked_by = :workerId,
    locked_until = NOW(3) + INTERVAL 3 MINUTE,
    heartbeat_at = NOW(3), attempts = attempts + 1
WHERE run_at <= NOW(3)
  AND attempts < max_attempts
  AND ( status IN ('queued','retry')
        OR (status = 'running' AND locked_until < NOW(3)) )
ORDER BY priority, run_at
LIMIT :limit`;

/** Backoff by attempt number (SCH-09): 1 min, 5 min, 30 min, 2 h, 12 h. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000] as const;

export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1]!;
}

export const LEASE_MS = 3 * 60_000;
export const HEARTBEAT_MS = 60_000;

export class InMemoryJobStore {
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;

  enqueue(input: {
    type: string;
    payload: unknown;
    runAt: Date;
    priority?: number;
    maxAttempts?: number;
    dedupeKey?: string;
  }): Job | null {
    if (input.dedupeKey) {
      for (const j of this.jobs.values()) if (j.dedupeKey === input.dedupeKey) return null; // unique dedupe_key
    }
    const job: Job = {
      id: this.nextId++,
      type: input.type,
      payload: input.payload,
      status: 'queued',
      priority: input.priority ?? 5,
      runAt: input.runAt,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      dedupeKey: input.dedupeKey ?? null,
      lastErrorCode: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: number): Job | undefined {
    return this.jobs.get(id);
  }

  all(): Job[] {
    return [...this.jobs.values()];
  }

  /** Atomic claim: new jobs and jobs whose lease expired (the v1.0 statement missed the second case). */
  claim(workerId: string, now: Date, limit: number): Job[] {
    const eligible = [...this.jobs.values()]
      .filter(
        (j) =>
          j.runAt <= now &&
          j.attempts < j.maxAttempts &&
          (j.status === 'queued' ||
            j.status === 'retry' ||
            (j.status === 'running' && j.lockedUntil !== null && j.lockedUntil < now)),
      )
      .sort((a, b) => a.priority - b.priority || a.runAt.getTime() - b.runAt.getTime())
      .slice(0, limit);
    for (const j of eligible) {
      j.status = 'running';
      j.lockedBy = workerId;
      j.lockedUntil = new Date(now.getTime() + LEASE_MS);
      j.heartbeatAt = now;
      j.attempts += 1;
    }
    return eligible.map((j) => ({ ...j }));
  }

  /** Extend the lease; false if the job is no longer ours (lease lost), so the handler must stop. */
  heartbeat(id: number, workerId: string, now: Date): boolean {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.lockedBy !== workerId) return false;
    if (j.lockedUntil && j.lockedUntil < now) return false;
    j.heartbeatAt = now;
    j.lockedUntil = new Date(now.getTime() + LEASE_MS);
    return true;
  }

  complete(id: number, workerId: string): boolean {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.lockedBy !== workerId) return false;
    j.status = 'succeeded';
    j.lockedBy = null;
    j.lockedUntil = null;
    return true;
  }

  /** Handler failed: retry with backoff, or fail permanently when attempts are exhausted. */
  fail(id: number, workerId: string, errorCode: string, now: Date): boolean {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.lockedBy !== workerId) return false;
    j.lastErrorCode = errorCode;
    j.lockedBy = null;
    j.lockedUntil = null;
    if (j.attempts >= j.maxAttempts) {
      j.status = 'failed';
    } else {
      j.status = 'retry';
      j.runAt = new Date(now.getTime() + backoffMs(j.attempts));
    }
    return true;
  }

  /** Graceful shutdown release (SCH-06): back to retry without consuming an attempt. */
  release(id: number, workerId: string): boolean {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.lockedBy !== workerId) return false;
    j.status = 'retry';
    j.lockedBy = null;
    j.lockedUntil = null;
    j.attempts = Math.max(0, j.attempts - 1);
    return true;
  }

  /** Jobs whose lease expired with no attempts left are failed and surfaced (SCH-09). */
  sweepExhausted(now: Date): Job[] {
    const out: Job[] = [];
    for (const j of this.jobs.values()) {
      if (
        j.status === 'running' &&
        j.lockedUntil &&
        j.lockedUntil < now &&
        j.attempts >= j.maxAttempts
      ) {
        j.status = 'failed';
        j.lastErrorCode = 'LEASE_EXPIRED_MAX_ATTEMPTS';
        j.lockedBy = null;
        j.lockedUntil = null;
        out.push({ ...j });
      }
    }
    return out;
  }
}

export type Handler = (
  job: Job,
  ctx: { heartbeat: () => boolean; shouldStop: () => boolean },
) => Promise<void>;

export class JobWorker {
  private stopping = false;
  private readonly inFlight = new Set<number>();

  constructor(
    private readonly store: InMemoryJobStore,
    private readonly workerId: string,
    private readonly handlers: Record<string, Handler>,
    private readonly now: () => Date,
  ) {}

  /** Claim and run up to `limit` jobs. Stops claiming once shutdown has begun (SCH-04). */
  async runOnce(limit = 5): Promise<number> {
    if (this.stopping) return 0;
    const claimed = this.store.claim(this.workerId, this.now(), limit);
    await Promise.all(claimed.map((job) => this.run(job)));
    return claimed.length;
  }

  private async run(job: Job): Promise<void> {
    const handler = this.handlers[job.type];
    this.inFlight.add(job.id);
    try {
      if (!handler) {
        this.store.fail(job.id, this.workerId, 'NO_HANDLER', this.now());
        return;
      }
      await handler(job, {
        heartbeat: () => this.store.heartbeat(job.id, this.workerId, this.now()),
        shouldStop: () => this.stopping,
      });
      if (this.stopping && this.store.get(job.id)?.status === 'running') {
        // handler yielded because of shutdown without finishing: hand the job back without consuming an attempt
        this.store.release(job.id, this.workerId);
      } else {
        this.store.complete(job.id, this.workerId);
      }
    } catch (err) {
      this.store.fail(job.id, this.workerId, err instanceof Error ? err.name : 'ERROR', this.now());
    } finally {
      this.inFlight.delete(job.id);
    }
  }

  /** Begin shutdown: no new claims; resolves when in-flight handlers finish or the grace period passes. */
  async shutdown(graceMs: number): Promise<void> {
    this.stopping = true;
    const deadline = performance.now() + graceMs;
    while (this.inFlight.size > 0 && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    for (const id of this.inFlight) this.store.release(id, this.workerId);
  }
}
