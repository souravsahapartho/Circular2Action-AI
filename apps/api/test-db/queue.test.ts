import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Row } from '../src/db/pool';
import { SqlJobStore } from '../src/modules/jobs/sql-queue';
import { evidence, freshDatabase, type TestDb } from './helpers';

const JOBS = Number(process.env.S3_QUEUE_JOBS ?? 1000);
const WORKERS = Number(process.env.S3_QUEUE_WORKERS ?? 20);

/** Worker loop: claim, then perform the side effect in the same transaction as the fenced completion. */
async function workerLoop(
  t: TestDb,
  store: SqlJobStore,
  id: string,
  stats: { lostLease: number },
): Promise<number> {
  let done = 0;
  for (;;) {
    const jobs = await store.claim(id, 10);
    if (jobs.length === 0) {
      const [left] = await t.db.query<Row & { n: number }>(
        "SELECT COUNT(*) n FROM background_jobs WHERE status IN ('queued','retry','running')",
      );
      if (Number(left!.n) === 0) return done;
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }
    for (const job of jobs) {
      await t.db.transaction(
        async (tx) => {
          const ok = await store.complete(job, tx);
          if (!ok) {
            stats.lostLease++;
            return;
          }
          await tx.execute('INSERT INTO t_effects (job_id, worker) VALUES (:j, :w)', {
            j: job.id,
            w: id,
          });
        },
        { retries: 10 },
      );
      done++;
    }
  }
}

describe(`queue claim on TiDB (T-07, ${WORKERS} workers x ${JOBS} jobs)`, () => {
  let t: TestDb;
  let store: SqlJobStore;
  beforeAll(async () => {
    t = await freshDatabase({ migrate: true, pool: WORKERS + 4 });
    store = new SqlJobStore(t.db);
    // no unique key on job_id: a duplicate side effect must be visible, not hidden
    await t.db.execute(
      'CREATE TABLE t_effects (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), job_id BIGINT NOT NULL, worker VARCHAR(64) NOT NULL, KEY ix (job_id))',
    );
  });
  afterAll(async () => t.drop());
  // each scenario starts from an empty queue so one failure cannot cascade into the next
  beforeEach(async () => {
    await t.db.execute('DELETE FROM background_jobs');
  });

  it('dedupe_key prevents a second enqueue', async () => {
    const a = await store.enqueue({ type: 'noop', payload: {}, dedupeKey: 'dedupe-1' });
    const b = await store.enqueue({ type: 'noop', payload: {}, dedupeKey: 'dedupe-1' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    await t.db.execute("DELETE FROM background_jobs WHERE dedupe_key = 'dedupe-1'");
  });

  it('every job produces exactly one side effect under concurrent claims', async () => {
    for (let b = 0; b < JOBS; b += 500) {
      const n = Math.min(500, JOBS - b);
      const values = Array.from(
        { length: n },
        (_, i) => `('effect', '{"i":${b + i}}', ${(b + i) % 3}, NOW(3))`,
      ).join(',');
      await t.db.execute(
        `INSERT INTO background_jobs (type, payload, priority, run_at) VALUES ${values}`,
      );
    }
    const stats = { lostLease: 0 };
    const started = performance.now();
    const perWorker = await Promise.all(
      Array.from({ length: WORKERS }, (_, w) => workerLoop(t, store, `w${w}`, stats)),
    );
    const seconds = (performance.now() - started) / 1000;
    const [eff] = await t.db.query<Row & { total: number; distinctJobs: number }>(
      'SELECT COUNT(*) total, COUNT(DISTINCT job_id) distinctJobs FROM t_effects',
    );
    const [dups] = await t.db.query<Row & { n: number }>(
      'SELECT COUNT(*) n FROM (SELECT job_id FROM t_effects GROUP BY job_id HAVING COUNT(*) > 1) d',
    );
    const [ok] = await t.db.query<Row & { n: number }>(
      "SELECT COUNT(*) n FROM background_jobs WHERE status = 'succeeded'",
    );
    const [att] = await t.db.query<Row & { m: number }>(
      'SELECT MAX(attempts) m FROM background_jobs',
    );
    evidence('T-07', {
      jobs: JOBS,
      workers: WORKERS,
      effects: Number(eff!.total),
      distinctJobs: Number(eff!.distinctJobs),
      duplicateEffects: Number(dups!.n),
      succeeded: Number(ok!.n),
      maxAttempts: Number(att!.m),
      lostLease: stats.lostLease,
      perWorkerMin: Math.min(...perWorker),
      perWorkerMax: Math.max(...perWorker),
      seconds: Math.round(seconds * 10) / 10,
      jobsPerSecond: Math.round(JOBS / seconds),
    });
    expect(Number(eff!.total)).toBe(JOBS);
    expect(Number(eff!.distinctJobs)).toBe(JOBS);
    expect(Number(dups!.n)).toBe(0);
    expect(Number(ok!.n)).toBe(JOBS);
  });

  it('expired leases are reclaimed and the stale worker is fenced out', async () => {
    const id = (await store.enqueue({ type: 'crash', payload: {} }))!;
    const [first] = await store.claim('crashed-worker', 1);
    expect(first!.id).toBe(id);
    expect(await store.claim('other', 1)).toEqual([]);
    await t.db.execute(
      'UPDATE background_jobs SET locked_until = NOW(3) - INTERVAL 1 SECOND WHERE id = :id',
      { id },
    );
    const [again] = await store.claim('rescuer', 1);
    expect(again!.id).toBe(id);
    expect(again!.attempts).toBe(2);
    expect(await store.heartbeat(first!)).toBe(false);
    expect(await store.complete(first!)).toBe(false);
    expect(await store.release(first!)).toBe(false);
    expect(await store.heartbeat(again!)).toBe(true);
    expect(await store.complete(again!)).toBe(true);
    evidence('T-07-reclaim', {
      reclaimed: true,
      staleWorkerFenced: true,
      attemptsAfterReclaim: again!.attempts,
    });
  });

  it('failure schedules a retry with backoff; exhausted attempts fail; release keeps the attempt', async () => {
    const id = (await store.enqueue({ type: 'flaky', payload: {}, maxAttempts: 2 }))!;
    const [a] = await store.claim('w', 1);
    expect(await store.fail(a!, 'BOOM')).toBe(true);
    const [r1] = await t.db.query<Row & { status: string; secs: number }>(
      'SELECT status, TIMESTAMPDIFF(SECOND, NOW(3), run_at) secs FROM background_jobs WHERE id = :id',
      { id },
    );
    expect(r1!.status).toBe('retry');
    expect(Number(r1!.secs)).toBeGreaterThanOrEqual(55);
    await t.db.execute('UPDATE background_jobs SET run_at = NOW(3) WHERE id = :id', { id });
    const [b] = await store.claim('w', 1);
    expect(await store.release(b!)).toBe(true);
    const [r2] = await t.db.query<Row & { attempts: number }>(
      'SELECT attempts FROM background_jobs WHERE id = :id',
      { id },
    );
    expect(Number(r2!.attempts)).toBe(1);
    const [c] = await store.claim('w', 1);
    expect(await store.fail(c!, 'BOOM')).toBe(true);
    const [r3] = await t.db.query<Row & { status: string }>(
      'SELECT status FROM background_jobs WHERE id = :id',
      { id },
    );
    expect(r3!.status).toBe('failed');
  });

  it('a lease that expires with no attempts left is swept to failed', async () => {
    const id = (await store.enqueue({ type: 'stuck', payload: {}, maxAttempts: 1 }))!;
    const [a] = await store.claim('w', 1);
    expect(a!.id).toBe(id);
    await t.db.execute(
      'UPDATE background_jobs SET locked_until = NOW(3) - INTERVAL 1 SECOND WHERE id = :id',
      { id },
    );
    expect(await store.claim('w2', 1)).toEqual([]);
    expect(await store.sweepExhausted()).toBe(1);
    const [r] = await t.db.query<Row & { status: string; last_error_code: string }>(
      'SELECT status, last_error_code FROM background_jobs WHERE id = :id',
      { id },
    );
    expect(r!.status).toBe('failed');
    expect(r!.last_error_code).toBe('LEASE_EXPIRED_MAX_ATTEMPTS');
  });
});
