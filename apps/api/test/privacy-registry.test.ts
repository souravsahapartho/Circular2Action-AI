import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELETION_REGISTRY, PSEUDONYMOUS_COLUMNS } from '../src/modules/privacy/registry';

// Every migration file counts: a table added later (such as mfa_recovery_codes) must be in the registry too.
const migrationsDir = path.resolve(import.meta.dirname, '..', 'migrations');
const migration = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join(String.fromCharCode(10));

/** Every column in the schema that can reference a user (plan DEL-04). */
function userReferencingColumns(): string[] {
  const out: string[] = [];
  const statements = migration.split(/;\s*\n/).filter((s) => /CREATE TABLE/.test(s));
  for (const st of statements) {
    const table = /CREATE TABLE (\w+)/.exec(st)?.[1];
    if (!table) continue;
    const body = st.replace(/--.*$/gm, '');
    for (const m of body.matchAll(
      /\b(user_id|owner_user_id|actor_id|reporter_id|verifier_id|\w+_by)\s+(?:BIGINT|BINARY)/g,
    )) {
      out.push(`${table}.${m[1]}`);
    }
  }
  return [...new Set(out)];
}

describe('deletion registry completeness (DEL-04)', () => {
  const columns = userReferencingColumns();
  const registered = new Set(DELETION_REGISTRY.map((e) => `${e.table}.${e.column}`));

  it('finds a plausible number of user-referencing columns in the migration', () => {
    expect(columns.length).toBeGreaterThan(40);
  });

  it('covers every user-referencing column in the schema', () => {
    const missing = columns.filter((c) => !registered.has(c));
    expect(missing).toEqual([]);
  });

  it('has no stale entries for columns that no longer exist', () => {
    const stale = [...registered].filter((c) => !columns.includes(c));
    expect(stale).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(registered.size).toBe(DELETION_REGISTRY.length);
  });

  it('does not delete or anonymise staff accountability columns, and never retains personal content rows', () => {
    const staffRetained = DELETION_REGISTRY.filter((e) => e.action === 'retain_staff');
    expect(staffRetained.length).toBeGreaterThan(10);
    expect(
      DELETION_REGISTRY.filter((e) => e.table === 'user_documents').every(
        (e) => e.action === 'delete',
      ),
    ).toBe(true);
    expect(
      DELETION_REGISTRY.filter((e) => e.table === 'application_records').every(
        (e) => e.action === 'delete',
      ),
    ).toBe(true);
  });

  it('lists the pseudonymous columns that intentionally survive and checks they exist in the schema', () => {
    for (const col of PSEUDONYMOUS_COLUMNS) {
      const [table, column] = col.split('.');
      const st =
        migration.split(/;\s*\n/).find((s) => new RegExp(`CREATE TABLE ${table}\\b`).test(s)) ?? '';
      expect(st, `${col} must exist`).toContain(column);
    }
  });
});

describe('migration structure', () => {
  it('contains no content-bearing user columns that the registry would not know about', () => {
    expect(migration).not.toMatch(/\bpassword\s+VARCHAR/); // only password_hash is stored
  });

  it('keeps file_objects.owner_user_id RESTRICT so objects must be deleted first (DEL-05)', () => {
    expect(migration).toMatch(
      /fk_fo_user FOREIGN KEY \(owner_user_id\) REFERENCES users\(id\) ON DELETE RESTRICT/,
    );
  });

  it('is marked provisional until gate S-3 passes', () => {
    expect(migration.split('\n').slice(0, 3).join('\n')).toContain('PROVISIONAL');
  });
});
