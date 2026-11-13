import { loadSeedConfig } from '../platform/config';
import { seedDemo, seedReference } from './demo-seed';
import { createDb } from './pool';

/**
 * `pnpm --filter @c2a/api seed` seeds reference data (categories, locations).
 * Add `--demo` (and set ALLOW_DEMO_SEED=true) to also add the fictional, labelled demo opportunities.
 * Uses the DDL/DML migration user; never prints the connection URL.
 */
async function main(): Promise<void> {
  const demo = process.argv.includes('--demo');
  const cfg = loadSeedConfig();
  if (demo && !cfg.allowDemo) {
    throw new Error('Demo data needs ALLOW_DEMO_SEED=true (never set it in production).');
  }
  const db = createDb({ url: cfg.url, tls: cfg.tls, connectionLimit: 2 });
  try {
    const ref = await seedReference(db);
    console.warn(`reference data: ${ref.categories} categories, ${ref.locations} locations`);
    if (demo) console.warn(`demo opportunities created: ${await seedDemo(db, new Date())}`);
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
