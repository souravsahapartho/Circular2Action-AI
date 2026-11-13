import { describe, expect, it } from 'vitest';
import { TestClock } from '../src/platform/clock';
import {
  backoffMs,
  CLAIM_SQL,
  InMemoryJobStore,
  JobWorker,
  LEASE_MS,
} from '../src/modules/jobs/queue';
import {
  DEFAULT_GRACE_MS,
  materialiseReminders,
  reminderKey,
  type ReminderItem,
} from '../src/modules/jobs/reminders';

const T0 = new Date('2026-11-13T10:00:00Z');

describe('claim statement', () => {
  it('reclaims expired running jobs (the v1.0 statement did not)', () => {
    expect(CLAIM_SQL).toContain("status = 'running' AND locked_until < NOW(3)");
    expect(CLAIM_SQL).toContain('attempts < max_attempts');
  });
});

describe('job store semantics', () => {
  it('claims queued jobs by priority then run time and sets a lease', () => {
    const s = new InMemoryJobStore();
    s.enqueue({ type: 'a', payload: 1, runAt: T0, priority: 5 });
    s.enqueue({ type: 'b', payload: 2, runAt: T0, priority: 1 });
    const [first] = s.claim('w1', T0, 1);
    expect(first?.type).toBe('b');
    expect(first?.lockedUntil?.getTime()).toBe(T0.getTime() + LEASE_MS);
    expect(first?.attempts).toBe(1);
  });

  it('does not claim a running job before its lease expires, and does after', () => {
    const s = new InMemoryJobStore();
    s.enqueue({ type: 'a', payload: 1, runAt: T0 });
    s.claim('w1', T0, 5);
    expect(s.claim('w2', new Date(T0.getTime() + LEASE_MS - 1), 5)).toHaveLength(0);
    const re = s.claim('w2', new Date(T0.getTime() + LEASE_MS + 1), 5);
    expect(re).toHaveLength(1);
    expect(re[0]?.lockedBy).toBe('w2');
    expect(re[0]?.attempts).toBe(2); // the abandoned attempt counts
  });

  it('a heartbeat keeps the lease; a lost lease tells the old worker to stop', () => {
    const s = new InMemoryJobStore();
    s.enqueue({ type: 'a', payload: 1, runAt: T0 });
    const [j] = s.claim('w1', T0, 1);
    expect(s.heartbeat(j!.id, 'w1', new Date(T0.getTime() + 60_000))).toBe(true);
    // w1 stalls; lease lapses; w2 takes over
    const later = new Date(T0.getTime() + 60_000 + LEASE_MS + 1);
    s.claim('w2', later, 1);
    expect(s.heartbeat(j!.id, 'w1', later)).toBe(false);
    expect(s.complete(j!.id, 'w1')).toBe(false); // the stale worker cannot complete it
  });

  it('retries with backoff then fails permanently after max attempts', () => {
    const s = new InMemoryJobStore();
    s.enqueue({ type: 'a', payload: 1, runAt: T0, maxAttempts: 3 });
    let now = T0;
    for (let i = 1; i <= 3; i++) {
      const [j] = s.claim('w', now, 1);
      expect(j).toBeDefined();
      s.fail(j!.id, 'w', 'BOOM', now);
      const state = s.get(j!.id)!;
      if (i < 3) {
        expect(state.status).toBe('retry');
        expect(state.runAt.getTime()).toBe(now.getTime() + backoffMs(i));
        now = new Date(state.runAt.getTime() + 1);
      } else {
        expect(state.status).toBe('failed');
      }
    }
    expect(s.claim('w', new Date(now.getTime() + 24 * 3600_000), 1)).toHaveLength(0);
  });

  it('backoff schedule is 1 min, 5 min, 30 min, 2 h, 12 h', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
    ]);
    expect(backoffMs(9)).toBe(43_200_000);
  });

  it('releases a job on graceful shutdown without consuming an attempt', () => {
    const s = new InMemoryJobStore();
    s.enqueue({ type: 'a', payload: 1, runAt: T0 });
    const [j] = s.claim('w1', T0, 1);
    expect(s.release(j!.id, 'w1')).toBe(true);
    const after = s.get(j!.id)!;
    expect(after.status).toBe('retry');
    expect(after.attempts).toBe(0);
  });

  it('sweeps expired jobs with no attempts left to failed', () => {
    const s = new InMemoryJobStore();
    s.enqueue({ type: 'a', payload: 1, runAt: T0, maxAttempts: 1 });
    s.claim('w1', T0, 1);
    const swept = s.sweepExhausted(new Date(T0.getTime() + LEASE_MS + 1));
    expect(swept).toHaveLength(1);
    expect(s.get(swept[0]!.id)?.status).toBe('failed');
  });

  it('rejects a duplicate dedupe key', () => {
    const s = new InMemoryJobStore();
    expect(s.enqueue({ type: 'a', payload: 1, runAt: T0, dedupeKey: 'k' })).not.toBeNull();
    expect(s.enqueue({ type: 'a', payload: 1, runAt: T0, dedupeKey: 'k' })).toBeNull();
  });

  it('processes each of 1,000 jobs exactly once when three workers interleave claims', () => {
    const s = new InMemoryJobStore();
    for (let i = 0; i < 1000; i++) s.enqueue({ type: 'a', payload: i, runAt: T0 });
    const seen = new Map<number, number>();
    const workers = ['w1', 'w2', 'w3'];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const w of workers) {
        for (const j of s.claim(w, T0, 7)) {
          seen.set(j.id, (seen.get(j.id) ?? 0) + 1);
          s.complete(j.id, w);
          progressed = true;
        }
      }
    }
    expect(seen.size).toBe(1000);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });
});

describe('worker', () => {
  it('runs handlers and completes jobs; failures go to retry', async () => {
    const clock = new TestClock(T0);
    const s = new InMemoryJobStore();
    const ok = s.enqueue({ type: 'ok', payload: 1, runAt: T0 })!;
    const bad = s.enqueue({ type: 'bad', payload: 1, runAt: T0 })!;
    const w = new JobWorker(
      s,
      'w1',
      {
        ok: async () => undefined,
        bad: async () => {
          throw new Error('nope');
        },
      },
      () => clock.now(),
    );
    expect(await w.runOnce()).toBe(2);
    expect(s.get(ok.id)?.status).toBe('succeeded');
    expect(s.get(bad.id)?.status).toBe('retry');
  });

  it('on shutdown stops claiming and hands back a job that yields without finishing', async () => {
    const clock = new TestClock(T0);
    const s = new InMemoryJobStore();
    const job = s.enqueue({ type: 'long', payload: 1, runAt: T0 })!;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const w = new JobWorker(
      s,
      'w1',
      {
        long: async (_j, ctx) => {
          await gate;
          if (ctx.shouldStop()) return;
        },
      },
      () => clock.now(),
    );
    const running = w.runOnce();
    const shutting = w.shutdown(1000);
    release();
    await Promise.all([running, shutting]);
    expect(s.get(job.id)?.status).toBe('retry');
    expect(s.get(job.id)?.attempts).toBe(0);
    expect(await w.runOnce()).toBe(0); // no new claims after shutdown began
  });

  it('survives a SIGKILL-style crash: another worker reclaims after the lease and the effect happens once', async () => {
    const clock = new TestClock(T0);
    const s = new InMemoryJobStore();
    const job = s.enqueue({ type: 'email', payload: 'n1', runAt: T0 })!;
    const sent = new Set<string>(); // idempotency key (SCH-08): the side effect is keyed by payload
    const crashed = s.claim('dead-worker', T0, 1); // worker dies right after claiming
    expect(crashed).toHaveLength(1);
    clock.advanceMs(LEASE_MS + 1000);
    const w2 = new JobWorker(
      s,
      'w2',
      {
        email: async (j) => {
          sent.add(String(j.payload));
        },
      },
      () => clock.now(),
    );
    await w2.runOnce();
    await w2.runOnce();
    expect(s.get(job.id)?.status).toBe('succeeded');
    expect(sent.size).toBe(1);
  });
});

describe('reminder materialisation (SCH-10)', () => {
  const deadline = new Date('2026-12-15T11:00:00Z');
  const item: ReminderItem = {
    userId: 'u1',
    opportunityId: 'o1',
    deadlineAt: deadline,
    savedAt: new Date('2026-11-01T00:00:00Z'),
  };
  const offsets = [168, 72, 24];
  const slot = (h: number) => new Date(deadline.getTime() - h * 3600_000);

  it('sends a reminder when its slot becomes due', () => {
    const r = materialiseReminders([item], {
      offsetsHours: offsets,
      now: new Date(slot(72).getTime() + 5 * 60_000),
      watermark: new Date(slot(72).getTime() - 60_000),
    });
    expect(r.send.map((x) => x.offsetHours)).toEqual([72]);
    expect(r.send[0]?.late).toBe(false);
  });

  it('is idempotent: the same slot produces the same key and is not sent twice', () => {
    const now = new Date(slot(72).getTime() + 60_000);
    const first = materialiseReminders([item], {
      offsetsHours: offsets,
      now,
      watermark: new Date(slot(72).getTime() - 60_000),
    });
    const again = materialiseReminders([item], {
      offsetsHours: offsets,
      now,
      watermark: new Date(slot(72).getTime() - 60_000),
      existingKeys: new Set(first.send.map((s) => s.dedupeKey)),
    });
    expect(again.send).toHaveLength(0);
    expect(again.skipped[0]?.reason).toBe('already_materialised');
  });

  it('after a six-hour outage sends reminders inside the grace window as late and skips older ones (journey 34)', () => {
    // outage from slot(72)-1h to slot(72)+6h; service returns at slot(72)+5h (inside grace) and at +7h (beyond)
    const watermark = new Date(slot(72).getTime() - 3600_000);
    const inside = materialiseReminders([item], {
      offsetsHours: offsets,
      now: new Date(slot(72).getTime() + 5 * 3600_000),
      watermark,
    });
    expect(inside.send).toHaveLength(1);
    expect(inside.send[0]?.late).toBe(true);
    const beyond = materialiseReminders([item], {
      offsetsHours: offsets,
      now: new Date(slot(72).getTime() + 7 * 3600_000),
      watermark,
    });
    expect(beyond.send).toHaveLength(0);
    expect(beyond.skipped[0]?.reason).toBe('missed_grace');
    expect(DEFAULT_GRACE_MS).toBe(6 * 3600_000);
  });

  it('never sends after the deadline', () => {
    const r = materialiseReminders([item], {
      offsetsHours: [1],
      now: new Date(deadline.getTime() + 60_000),
      watermark: new Date(deadline.getTime() - 2 * 3600_000),
      graceMs: 48 * 3600_000,
    });
    expect(r.send).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe('deadline_passed');
  });

  it('skips slots earlier than the time the user saved the item', () => {
    const late: ReminderItem = { ...item, savedAt: new Date(slot(72).getTime() + 3600_000) };
    const r = materialiseReminders([late], {
      offsetsHours: offsets,
      now: new Date(slot(72).getTime() + 2 * 3600_000),
      watermark: new Date(slot(72).getTime() - 60_000),
    });
    expect(r.send).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe('before_saved');
  });

  it('a changed deadline produces new slots with new keys (old reminders do not block them)', () => {
    const extended = new Date(deadline.getTime() + 7 * 86_400_000);
    expect(reminderKey('u1', 'o1', new Date(extended.getTime() - 72 * 3600_000))).not.toBe(
      reminderKey('u1', 'o1', slot(72)),
    );
  });

  it('does not re-send older slots on later runs (watermark window)', () => {
    const r = materialiseReminders([item], {
      offsetsHours: offsets,
      now: new Date(slot(24).getTime() + 60_000),
      watermark: new Date(slot(24).getTime() - 60_000),
    });
    expect(r.send.map((x) => x.offsetHours)).toEqual([24]);
  });
});
