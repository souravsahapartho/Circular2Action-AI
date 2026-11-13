import path from 'node:path';
import { loadMigrationConfig } from '../platform/config';
import { migrate, readMigrations } from './migrate';
import { createDb } from './pool';

/** `pnpm --filter @c2a/api migrate` — applies pending migrations with the DDL user. Never prints the URL. */
async function main(): Promise<void> {
  const cfg = loadMigrationConfig();
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
