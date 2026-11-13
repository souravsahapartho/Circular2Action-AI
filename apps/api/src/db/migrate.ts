import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './pool';
import { splitSql } from './sql-split';

/**
 * Forward-only SQL migration runner (plan section 11.16).
 * TiDB DDL is not transactional, so progress is recorded per statement: a migration that fails half-way
 * resumes at the failed statement on the next run, provided the file has not changed. A changed file that was
 * already applied is refused (checksum mismatch).
 */
export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir: string): MigrationFile[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      return {
        version: f.slice(0, 4),
        name: f.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  db: Db,
  files: MigrationFile[],
  log: (msg: string) => void = () => undefined,
): Promise<MigrateResult> {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version CHAR(4) NOT NULL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    checksum CHAR(64) NOT NULL,
    statements_total INT NOT NULL,
    statements_applied INT NOT NULL,
    completed_at DATETIME(3) NULL,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);
  const rows = await db.query<
    {
      version: string;
      checksum: string;
      statements_applied: number;
      completed_at: Date | null;
    } & import('./pool').Row
  >('SELECT version, checksum, statements_applied, completed_at FROM schema_migrations');
  const state = new Map(rows.map((r) => [r.version, r]));
  const result: MigrateResult = { applied: [], skipped: [] };

  for (const m of files) {
    const prior = state.get(m.version);
    if (prior && prior.checksum !== m.checksum) {
      throw new Error(
        `Migration ${m.name} was changed after it was applied (checksum mismatch). Add a new migration instead.`,
      );
    }
    if (prior?.completed_at) {
      result.skipped.push(m.name);
      continue;
    }
    const statements = splitSql(m.sql);
    let from = prior?.statements_applied ?? 0;
    if (!prior) {
      await db.execute(
        'INSERT INTO schema_migrations (version, name, checksum, statements_total, statements_applied) VALUES (:v, :n, :c, :t, 0)',
        { v: m.version, n: m.name, c: m.checksum, t: statements.length },
      );
    } else {
      log(`resuming ${m.name} at statement ${from + 1}/${statements.length}`);
    }
    for (; from < statements.length; from++) {
      const st = statements[from]!;
      try {
        await db.execute(st);
      } catch (err) {
        const head = st.replace(/\s+/g, ' ').slice(0, 120);
        throw new Error(
          `Migration ${m.name} failed at statement ${from + 1}/${statements.length} (${head}...): ${(err as Error).message}`,
        );
      }
      await db.execute('UPDATE schema_migrations SET statements_applied = :a WHERE version = :v', {
        a: from + 1,
        v: m.version,
      });
    }
    await db.execute(
      'UPDATE schema_migrations SET completed_at = CURRENT_TIMESTAMP(3) WHERE version = :v',
      { v: m.version },
    );
    log(`applied ${m.name} (${statements.length} statements)`);
    result.applied.push(m.name);
  }
  return result;
}
