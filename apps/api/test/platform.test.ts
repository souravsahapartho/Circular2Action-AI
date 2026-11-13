import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { TestClock } from '../src/platform/clock';
import { loadConfig } from '../src/platform/config';
import { toErrorBody, AppError } from '../src/platform/errors';
import { ReplayCache, signInternal, verifyInternal } from '../src/platform/hmac';
import { loggerOptions } from '../src/platform/logger';
import { RateLimiter } from '../src/platform/rate-limit';

const SECRET = 'a'.repeat(40);
const baseEnv = { INTERNAL_HMAC_SECRETS: SECRET, NODE_ENV: 'test' };

describe('config', () => {
  it('loads defaults and splits rotating secrets', () => {
    const c = loadConfig({ ...baseEnv, INTERNAL_HMAC_SECRETS: `${SECRET},${'b'.repeat(40)}` });
    expect(c.hmacSecrets).toHaveLength(2);
    expect(c.HOSTING_TIER).toBe('free');
  });

  it('refuses a keep-alive interval on the free tier (SCH-02)', () => {
    expect(() =>
      loadConfig({ ...baseEnv, HOSTING_TIER: 'free', SCHEDULER_INTERVAL_MIN: '10' }),
    ).toThrow(/keep-alive/);
    expect(() =>
      loadConfig({ ...baseEnv, HOSTING_TIER: 'free', SCHEDULER_INTERVAL_MIN: '15' }),
    ).toThrow(/keep-alive/);
    expect(() =>
      loadConfig({ ...baseEnv, HOSTING_TIER: 'free', SCHEDULER_INTERVAL_MIN: '30' }),
    ).not.toThrow();
  });

  it('allows short intervals on a paid tier', () => {
    expect(() =>
      loadConfig({ ...baseEnv, HOSTING_TIER: 'paid', SCHEDULER_INTERVAL_MIN: '5' }),
    ).not.toThrow();
  });

  it('refuses production on the free tier and the mock AI provider in production', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        APP_ENV: 'production',
        HOSTING_TIER: 'free',
        AI_PROVIDER: 'gemini',
      }),
    ).toThrow(/free hosting tier/);
    expect(() =>
      loadConfig({ ...baseEnv, APP_ENV: 'production', HOSTING_TIER: 'paid', AI_PROVIDER: 'mock' }),
    ).toThrow(/mock AI/);
  });

  it('refuses missing or short secrets', () => {
    expect(() => loadConfig({})).toThrow(/INTERNAL_HMAC_SECRETS/);
    expect(() => loadConfig({ INTERNAL_HMAC_SECRETS: 'short' })).toThrow(/32 characters/);
  });
});

describe('internal HMAC verification', () => {
  const now = 1_800_000_000_000;
  const body = '{}';
  const sig = signInternal(SECRET, now, body);

  it('accepts a valid signature once and rejects the replay', () => {
    const replay = new ReplayCache();
    const args = {
      secrets: [SECRET],
      timestamp: String(now),
      signature: sig,
      body,
      nowMs: now,
      replay,
    };
    expect(verifyInternal(args)).toBe('ok');
    expect(verifyInternal(args)).toBe('replayed');
  });

  it('accepts a previous secret during rotation', () => {
    const replay = new ReplayCache();
    expect(
      verifyInternal({
        secrets: ['z'.repeat(40), SECRET],
        timestamp: String(now),
        signature: sig,
        body,
        nowMs: now,
        replay,
      }),
    ).toBe('ok');
  });

  it('rejects clock skew beyond five minutes, tampered bodies and malformed input', () => {
    const replay = new ReplayCache();
    expect(
      verifyInternal({
        secrets: [SECRET],
        timestamp: String(now),
        signature: sig,
        body,
        nowMs: now + 6 * 60_000,
        replay,
      }),
    ).toBe('expired');
    expect(
      verifyInternal({
        secrets: [SECRET],
        timestamp: String(now),
        signature: sig,
        body: '{"x":1}',
        nowMs: now,
        replay,
      }),
    ).toBe('bad_signature');
    expect(
      verifyInternal({
        secrets: [SECRET],
        timestamp: undefined,
        signature: sig,
        body,
        nowMs: now,
        replay,
      }),
    ).toBe('malformed');
    expect(
      verifyInternal({
        secrets: [SECRET],
        timestamp: String(now),
        signature: 'nothex',
        body,
        nowMs: now,
        replay,
      }),
    ).toBe('malformed');
  });

  it('accepts skew inside the window', () => {
    const replay = new ReplayCache();
    expect(
      verifyInternal({
        secrets: [SECRET],
        timestamp: String(now),
        signature: sig,
        body,
        nowMs: now + 4 * 60_000,
        replay,
      }),
    ).toBe('ok');
  });
});

describe('rate limiter', () => {
  it('allows a burst up to capacity then blocks, then refills', () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect(rl.take('k', 0).allowed).toBe(true);
    expect(rl.take('k', 0).allowed).toBe(true);
    expect(rl.take('k', 0).allowed).toBe(true);
    const blocked = rl.take('k', 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(rl.take('k', 1000).allowed).toBe(true);
  });

  it('keeps keys independent and bounds memory', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0.001 }, 2);
    expect(rl.take('a', 0).allowed).toBe(true);
    expect(rl.take('b', 0).allowed).toBe(true);
    expect(rl.take('c', 0).allowed).toBe(true); // evicts the oldest key instead of growing
    expect(rl.take('a', 1).allowed).toBe(true); // 'a' was evicted so it starts fresh
  });
});

describe('error mapping', () => {
  it('maps AppError codes to their documented HTTP status', () => {
    expect(toErrorBody(new AppError('CONSENT_REQUIRED', 'x'), 'r1').status).toBe(403);
    expect(toErrorBody(new AppError('UPLOAD_NOT_VALIDATED', 'x'), 'r1').status).toBe(409);
    expect(toErrorBody(new AppError('REGISTRATION_PAUSED', 'x'), 'r1').status).toBe(503);
  });

  it('never leaks internals for unknown errors', () => {
    const r = toErrorBody(new Error('SELECT * FROM users WHERE password = secret'), 'r1');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/SELECT|secret/);
    expect(r.body.error.request_id).toBe('r1');
  });
});

describe('logger redaction', () => {
  it('redacts credentials, emails and free text', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(c, _e, cb) {
        chunks.push(String(c));
        cb();
      },
    });
    const log = pino(loggerOptions('info'), stream);
    log.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'session=xyz' } },
        body: {
          password: 'hunter2',
          email: 'a@b.com',
          token: 'tok',
          text: 'CANARY-PII-9f3a document text',
        },
        user: { email: 'u@example.com' },
      },
      'test',
    );
    const out = chunks.join('');
    for (const secret of ['Bearer abc', 'session=xyz', 'hunter2', 'a@b.com', 'u@example.com'])
      expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });
});

describe('http app', () => {
  const config = loadConfig({ ...baseEnv, APP_ENV: 'local' });
  const clock = new TestClock(new Date('2026-11-13T10:00:00Z'));

  it('serves health and readiness', async () => {
    const app = buildApp({ config, clock, readiness: [{ name: 'db', check: async () => true }] });
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(200);
    await app.close();
  });

  it('reports not ready when a dependency fails or throws', async () => {
    const app = buildApp({
      config,
      clock,
      readiness: [
        {
          name: 'db',
          check: async () => {
            throw new Error('down');
          },
        },
      ],
    });
    const r = await app.inject('/readyz');
    expect(r.statusCode).toBe(503);
    expect(r.json().checks[0]).toEqual({ name: 'db', ok: false });
    await app.close();
  });

  it('adds security headers and a standard 404 body', async () => {
    const app = buildApp({ config, clock });
    const r = await app.inject('/nope');
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('rate limits public requests with Retry-After', async () => {
    const app = buildApp({ config, clock });
    let last = 200;
    let retry: string | undefined;
    for (let i = 0; i < 130; i++) {
      const r = await app.inject('/nope');
      last = r.statusCode;
      retry = r.headers['retry-after'] as string | undefined;
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    await app.close();
  });

  it('rejects unsigned ticks and accepts a signed tick once', async () => {
    let ticks = 0;
    const app = buildApp({
      config,
      clock,
      onTick: async () => {
        ticks += 1;
        return { enqueued: 3 };
      },
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      payload: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.statusCode).toBe(401);
    const ts = clock.now().getTime();
    const headers = {
      'content-type': 'application/json',
      'x-c2a-timestamp': String(ts),
      'x-c2a-signature': signInternal(SECRET, ts, '{}'),
    };
    const ok = await app.inject({ method: 'POST', url: '/internal/tick', payload: '{}', headers });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().data.enqueued).toBe(3);
    const replayed = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      payload: '{}',
      headers,
    });
    expect(replayed.statusCode).toBe(401);
    expect(ticks).toBe(1);
    await app.close();
  });
});
