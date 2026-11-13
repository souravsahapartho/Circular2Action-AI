import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { migrate, readMigrations } from '../src/db/migrate';
import { createDb, type Db } from '../src/db/pool';

export const SERVER_URL = process.env.TEST_DATABASE_URL ?? 'mysql://root@127.0.0.1:4100/';
export const TLS = process.env.TEST_DATABASE_TLS === 'true';
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', 'migrations');

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export interface TestDb {
  db: Db;
  name: string;
  url: string;
  drop: () => Promise<void>;
}

/** Creates an empty, uniquely named database for one test file; `drop` removes it. */
export async function freshDatabase(
  opts: { migrate?: boolean; pool?: number } = {},
): Promise<TestDb> {
  const name = `c2a_t_${randomBytes(4).toString('hex')}`;
  const admin = createDb({ url: SERVER_URL, tls: TLS, connectionLimit: 1 });
  await admin.execute(`CREATE DATABASE ${name}`);
  await admin.close();
  const url = withDatabase(SERVER_URL, name);
  const db = createDb({ url, tls: TLS, connectionLimit: opts.pool ?? 10 });
  if (opts.migrate) await migrate(db, readMigrations(MIGRATIONS_DIR));
  return {
    db,
    name,
    url,
    drop: async () => {
      await db.close();
      const a = createDb({ url: SERVER_URL, tls: TLS, connectionLimit: 1 });
      await a.execute(`DROP DATABASE IF EXISTS ${name}`);
      await a.close();
    },
  };
}

/** Results recorded for the gate evidence (docs/spikes/S-3). Printed as one JSON line per test. */
export function evidence(test: string, data: Record<string, unknown>): void {
  console.warn(`S3-EVIDENCE ${JSON.stringify({ test, ...data })}`);
}
