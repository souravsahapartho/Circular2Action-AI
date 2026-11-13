import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/db/pool';
import { databaseCheck } from '../src/db/readiness';
import { loadConfig } from '../src/platform/config';
import { freshDatabase, type TestDb } from './helpers';

const config = loadConfig({
  NODE_ENV: 'test',
  INTERNAL_HMAC_SECRETS: 'x'.repeat(40),
});

describe('/readyz checks the database', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await freshDatabase();
  });
  afterAll(async () => t.drop());

  it('is ready when the database answers', async () => {
    const app = buildApp({ config, readiness: [databaseCheck(t.db)] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: [{ name: 'database', ok: true }] });
  });

  it('is unavailable when the database is unreachable', async () => {
    const dead = createDb({ url: 'mysql://root@127.0.0.1:1/none', tls: false, connectionLimit: 1 });
    const app = buildApp({ config, readiness: [databaseCheck(dead, 1500)] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual([{ name: 'database', ok: false }]);
    await dead.close();
  });

  it('is unavailable when no database is configured', async () => {
    const app = buildApp({ config, readiness: [databaseCheck(null)] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
  });
});
