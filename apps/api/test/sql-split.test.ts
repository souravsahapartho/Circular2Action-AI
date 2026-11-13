import { describe, expect, it } from 'vitest';
import { splitSql } from '../src/db/sql-split';

describe('splitSql', () => {
  it('splits at top-level semicolons only', () => {
    const sql = `CREATE TABLE a (x VARCHAR(5) DEFAULT 'a;b'); -- c;d
/* e;f */ INSERT INTO a VALUES ("g;h"), ('it''s;'); SELECT \`we;ird\` FROM a;
-- only a comment;
`;
    expect(splitSql(sql)).toEqual([
      "CREATE TABLE a (x VARCHAR(5) DEFAULT 'a;b')",
      `-- c;d
/* e;f */ INSERT INTO a VALUES ("g;h"), ('it''s;')`,
      'SELECT `we;ird` FROM a',
    ]);
  });

  it('keeps a final statement without a semicolon and drops empty fragments', () => {
    expect(splitSql(';;SELECT 1')).toEqual(['SELECT 1']);
  });

  it('splits the real migration into one statement per table plus SET NAMES and the view', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sql = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'migrations', '0001_init.sql'),
      'utf8',
    );
    const st = splitSql(sql);
    expect(st.filter((s) => /CREATE TABLE/.test(s)).length).toBe(72);
    expect(st.filter((s) => /CREATE VIEW/.test(s)).length).toBe(1);
  });
});
