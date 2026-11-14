import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, readMigrations } from '../src/db/migrate';
import { evidence, freshDatabase, MIGRATIONS_DIR, type TestDb } from './helpers';

describe('migration runner on TiDB (T-10 equivalent with plain SQL)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await freshDatabase();
  });
  afterAll(async () => t.drop());

  it('applies every migration to an empty database', async () => {
    const started = performance.now();
    const res = await migrate(t.db, readMigrations(MIGRATIONS_DIR));
    const ms = Math.round(performance.now() - started);
    expect(res.applied).toEqual(['0001_init', '0002_staff_mfa', '0003_portal']);
    const [tables] = await t.db.query<{ n: number } & import('../src/db/pool').Row>(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
    );
    const [views] = await t.db.query<{ n: number } & import('../src/db/pool').Row>(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'VIEW'`,
    );
    const [fks] = await t.db.query<{ n: number } & import('../src/db/pool').Row>(
      `SELECT COUNT(*) AS n FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()`,
    );
    evidence('migrate-from-empty', {
      applied: res.applied,
      baseTables: Number(tables!.n),
      views: Number(views!.n),
      foreignKeys: Number(fks!.n),
      ms,
    });
    expect(Number(tables!.n)).toBe(78); // 72 plan tables + mfa_recovery_codes + 4 portal tables + schema_migrations
    expect(Number(views!.n)).toBe(1);
  });

  it('is idempotent on a second run', async () => {
    const res = await migrate(t.db, readMigrations(MIGRATIONS_DIR));
    expect(res.applied).toEqual([]);
  });

  it('applies an incremental expand migration and refuses an edited applied migration', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2a-mig-'));
    for (const f of fs.readdirSync(MIGRATIONS_DIR))
      fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    fs.writeFileSync(
      path.join(dir, '9001_expand.sql'),
      `ALTER TABLE organizations ADD COLUMN test_note VARCHAR(40) NULL;
       CREATE TABLE t_child (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), org_id BIGINT NOT NULL,
         CONSTRAINT fk_tc_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE);`,
    );
    const res = await migrate(t.db, readMigrations(dir));
    expect(res.applied).toEqual(['9001_expand']);
    fs.appendFileSync(path.join(dir, '9001_expand.sql'), '\n-- edited');
    await expect(migrate(t.db, readMigrations(dir))).rejects.toThrow(/checksum mismatch/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
