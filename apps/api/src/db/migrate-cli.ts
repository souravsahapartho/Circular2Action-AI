import path from 'node:path';
import { loadMigrationConfig } from '../platform/config';
import { migrate, readMigrations } from './migrate';
import { createDb } from './pool';

/** `pnpm --filter @c2a/api migrate` — applies pending migrations with the DDL user. Never prints the URL. */
async function main(): Promise<void> {
  const cfg = loadMigrationConfig();
  // Create the target database if it is missing (Starter starts with only `test`).
  const target = new URL(cfg.url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^\w{1,64}$/.test(dbName))
    throw new Error('DATABASE_URL must name a database, e.g. /c2a_staging');
  const serverUrl = new URL(cfg.url);
  serverUrl.pathname = '/';
  const admin = createDb({ url: serverUrl.toString(), tls: cfg.tls, connectionLimit: 1 });
  try {
    await admin.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  } finally {
    await admin.close();
  }
  const db = createDb({ url: cfg.url, tls: cfg.tls, connectionLimit: 1 });
  try {
    const dir = path.resolve(import.meta.dirname, '..', '..', 'migrations');
    const res = await migrate(db, readMigrations(dir), (m) => console.warn(m));
    console.warn(
      `migrations: ${res.applied.length} applied, ${res.skipped.length} already present`,
    );
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
