import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../src/db/pool';
import { evidence, freshDatabase, type TestDb } from './helpers';

// Gate S-3 compatibility tests (plan section 11.20, T-01 .. T-09). Each writes an evidence line.
describe('TiDB compatibility (gate S-3)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await freshDatabase();
  });
  afterAll(async () => t.drop());

  it('reports the server version', async () => {
    const [r] = await t.db.query<Row & { v: string }>('SELECT tidb_version() AS v');
    evidence('version', { tidb: String(r!.v).split('\n').slice(0, 3).join(' | ') });
    expect(String(r!.v)).toMatch(/Release Version/);
  });

  it('T-01 AUTO_RANDOM(5, 54): 10,000 ids below 2^53, retrievable as insertId and as strings', async () => {
    await t.db.execute(
      'CREATE TABLE t01 (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), v VARCHAR(20) NOT NULL)',
    );
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const res = await t.db.execute('INSERT INTO t01 (v) VALUES (:v)', { v: `single-${i}` });
      ids.push(String(res.insertId));
    }
    for (let b = 0; b < 49; b++) {
      const values = Array.from({ length: 200 }, (_, i) => `('bulk-${b}-${i}')`).join(',');
      await t.db.execute(`INSERT INTO t01 (v) VALUES ${values}`);
    }
    const rows = await t.db.query<Row & { id: string; v: string }>('SELECT id, v FROM t01');
    expect(rows.length).toBe(10_000);
    const max = rows.reduce((m, r) => (BigInt(r.id) > m ? BigInt(r.id) : m), 0n);
    const safe = rows.every((r) => BigInt(r.id) < 2n ** 53n && BigInt(r.id) > 0n);
    const unique = new Set(rows.map((r) => r.id)).size;
    const byV = new Map(rows.map((r) => [r.v, r.id]));
    const insertIdMatches = ids.every((id, i) => byV.get(`single-${i}`) === id);
    const probe = rows[1234]!;
    const back = await t.db.query<Row & { v: string }>('SELECT v FROM t01 WHERE id = :id', {
      id: probe.id,
    });
    evidence('T-01', {
      rows: rows.length,
      unique,
      maxId: max.toString(),
      below2pow53: safe,
      insertIdMatches,
    });
    expect(safe).toBe(true);
    expect(unique).toBe(10_000);
    expect(insertIdMatches).toBe(true);
    expect(back[0]!.v).toBe(probe.v);
  });

  it('T-02 explicit ids into AUTO_RANDOM are rejected by default; composite AUTO_RANDOM key works', async () => {
    let errno: number | undefined;
    try {
      await t.db.execute("INSERT INTO t01 (id, v) VALUES (42, 'explicit')");
    } catch (e) {
      errno = (e as { errno?: number }).errno;
    }
    await t.db.execute(
      'CREATE TABLE t02 (id BIGINT AUTO_RANDOM(5, 54), k INT NOT NULL, PRIMARY KEY (id, k))',
    );
    await t.db.execute('INSERT INTO t02 (k) VALUES (1), (2)');
    const rows = await t.db.query('SELECT id FROM t02');
    evidence('T-02', { explicitInsertErrno: errno ?? null, compositeRows: rows.length });
    expect(errno).toBeDefined();
    expect(rows.length).toBe(2);
  });

  it('T-03 foreign keys: violation rejected (1452), CASCADE, SET NULL, ALTER with checks disabled', async () => {
    const [fkVar] = await t.db.query<Row & { Value: string }>(
      "SHOW VARIABLES LIKE 'foreign_key_checks'",
    );
    await t.db.execute(
      'CREATE TABLE p03 (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), name VARCHAR(20))',
    );
    await t.db
      .execute(`CREATE TABLE c03 (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), p_id BIGINT NOT NULL,
      CONSTRAINT fk_c03 FOREIGN KEY (p_id) REFERENCES p03(id) ON DELETE CASCADE)`);
    await t.db
      .execute(`CREATE TABLE n03 (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), p_id BIGINT NULL,
      CONSTRAINT fk_n03 FOREIGN KEY (p_id) REFERENCES p03(id) ON DELETE SET NULL)`);
    let violation: number | undefined;
    try {
      await t.db.execute('INSERT INTO c03 (p_id) VALUES (999)');
    } catch (e) {
      violation = (e as { errno?: number }).errno;
    }
    const p = await t.db.execute("INSERT INTO p03 (name) VALUES ('parent')");
    const pid = String(p.insertId);
    await t.db.execute('INSERT INTO c03 (p_id) VALUES (:p)', { p: pid });
    await t.db.execute('INSERT INTO n03 (p_id) VALUES (:p)', { p: pid });
    await t.db.execute('DELETE FROM p03 WHERE id = :p', { p: pid });
    const [c] = await t.db.query<Row & { n: number }>('SELECT COUNT(*) n FROM c03');
    const [nn] = await t.db.query<Row & { n: number }>(
      'SELECT COUNT(*) n FROM n03 WHERE p_id IS NULL',
    );
    const altered = await t.db.transaction(async (tx) => {
      await tx.execute('SET foreign_key_checks = 0');
      await tx.execute('ALTER TABLE c03 DROP FOREIGN KEY fk_c03');
      await tx.execute(
        'ALTER TABLE c03 ADD CONSTRAINT fk_c03b FOREIGN KEY (p_id) REFERENCES p03(id) ON DELETE RESTRICT',
      );
      await tx.execute('SET foreign_key_checks = 1');
      return true;
    });
    evidence('T-03', {
      foreignKeyChecks: fkVar?.Value,
      violationErrno: violation ?? null,
      cascadeRemaining: Number(c!.n),
      setNullRows: Number(nn!.n),
      alterWithChecksDisabled: altered,
    });
    expect(violation).toBe(1452);
    expect(Number(c!.n)).toBe(0);
    expect(Number(nn!.n)).toBe(1);
  });

  it('T-04 CHECK constraints: record the setting and the behaviour (no business rule relies on CHECK, DBC-03)', async () => {
    const [v] = await t.db.query<Row & { Value: string }>(
      "SHOW VARIABLES LIKE 'tidb_enable_check_constraint'",
    );
    await t.db.execute('CREATE TABLE t04 (n INT NOT NULL, CONSTRAINT ck_t04 CHECK (n > 0))');
    let enforced = false;
    try {
      await t.db.execute('INSERT INTO t04 (n) VALUES (-1)');
    } catch {
      enforced = true;
    }
    evidence('T-04', { tidb_enable_check_constraint: v?.Value ?? 'absent', enforced });
    expect(typeof enforced).toBe('boolean');
  });

  it('T-05 unique keys with Bangla strings and NULL duplicates', async () => {
    await t.db.execute(
      'CREATE TABLE t05 (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), slug VARCHAR(191) NULL, UNIQUE KEY uq_t05 (slug))',
    );
    const slug = 'সহকারী-শিক্ষক';
    await t.db.execute('INSERT INTO t05 (slug) VALUES (:s), (NULL), (NULL)', { s: slug });
    let dup: number | undefined;
    try {
      await t.db.execute('INSERT INTO t05 (slug) VALUES (:s)', { s: slug });
    } catch (e) {
      dup = (e as { errno?: number }).errno;
    }
    const [n] = await t.db.query<Row & { n: number }>(
      'SELECT COUNT(*) n FROM t05 WHERE slug IS NULL',
    );
    const [back] = await t.db.query<Row & { slug: string }>(
      'SELECT slug FROM t05 WHERE slug IS NOT NULL',
    );
    evidence('T-05', {
      duplicateErrno: dup ?? null,
      nullRows: Number(n!.n),
      banglaRoundTrip: back!.slug === slug,
    });
    expect(dup).toBe(1062);
    expect(Number(n!.n)).toBe(2);
    expect(back!.slug).toBe(slug);
  });

  it('T-06 concurrent updates on one row: pessimistic locking plus retry gives no lost updates', async () => {
    await t.db.execute('CREATE TABLE t06 (id INT PRIMARY KEY, n INT NOT NULL)');
    await t.db.execute('INSERT INTO t06 VALUES (1, 0)');
    const workers = 10;
    const per = 20;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let i = 0; i < per; i++) {
          await t.db.transaction(
            async (tx) => {
              const [r] = await tx.query<Row & { n: number }>(
                'SELECT n FROM t06 WHERE id = 1 FOR UPDATE',
              );
              await tx.execute('UPDATE t06 SET n = :n WHERE id = 1', { n: Number(r!.n) + 1 });
            },
            { retries: 10 },
          );
        }
      }),
    );
    const [r] = await t.db.query<Row & { n: number }>('SELECT n FROM t06 WHERE id = 1');
    evidence('T-06', { expected: workers * per, actual: Number(r!.n) });
    expect(Number(r!.n)).toBe(workers * per);
  });

  it('T-08 JSON round trip, JSON_EXTRACT filter and generated-column index', async () => {
    await t.db
      .execute(`CREATE TABLE t08 (id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54), params JSON NOT NULL,
      rule_type VARCHAR(32) AS (JSON_UNQUOTE(JSON_EXTRACT(params, '$.type'))) STORED,
      KEY ix_t08_rule (rule_type))`);
    const doc = {
      type: 'age_max',
      max: 30,
      as_of: '2026-11-01',
      label: 'বয়স',
      list: [3, 1, 2],
    };
    await t.db.execute('INSERT INTO t08 (params) VALUES (:p)', { p: JSON.stringify(doc) });
    await t.db.execute('INSERT INTO t08 (params) VALUES (:p)', {
      p: JSON.stringify({ type: 'gpa_min', min: 3.5 }),
    });
    const rows = await t.db.query<Row & { params: unknown }>(
      "SELECT params FROM t08 WHERE JSON_EXTRACT(params, '$.max') = 30",
    );
    const viaIndex = await t.db.query<Row & { id: string }>(
      "SELECT id FROM t08 WHERE rule_type = 'gpa_min'",
    );
    const plan = await t.db.query<Row>("EXPLAIN SELECT id FROM t08 WHERE rule_type = 'gpa_min'");
    const usesIndex = JSON.stringify(plan).includes('ix_t08_rule');
    evidence('T-08', {
      roundTripEqual: JSON.stringify(rows[0]?.params) === JSON.stringify(doc),
      generatedIndexRows: viaIndex.length,
      usesIndex,
    });
    expect(rows[0]?.params).toEqual(doc);
    expect(viaIndex.length).toBe(1);
    expect(usesIndex).toBe(true);
  });

  it('T-09 collation and key length: utf8mb4_bin, Bangla variants stay distinct, 3072-byte key limit', async () => {
    const [c] = await t.db.query<Row & { c: string; s: string }>(
      'SELECT @@collation_database AS c, @@character_set_database AS s',
    );
    await t.db.execute('CREATE TABLE t09 (a VARCHAR(100) NOT NULL)');
    // "RAB" written with and without ZWJ: distinct under utf8mb4_bin; normalisation lives in *_normalized columns
    const withZwj = 'র‍্যাব';
    const without = 'র্যাব';
    await t.db.execute('INSERT INTO t09 VALUES (:a), (:b)', { a: withZwj, b: without });
    const [d] = await t.db.query<Row & { n: number }>('SELECT COUNT(DISTINCT a) n FROM t09');
    await t.db.execute(
      'CREATE TABLE t09k (bucket VARCHAR(63) NOT NULL, object_key VARCHAR(255) NOT NULL, UNIQUE KEY uq (bucket, object_key))',
    );
    let tooLong: number | undefined;
    try {
      await t.db.execute(
        'CREATE TABLE t09x (a VARCHAR(800) NOT NULL, b VARCHAR(800) NOT NULL, KEY k (a, b))',
      );
    } catch (e) {
      tooLong = (e as { errno?: number }).errno;
    }
    evidence('T-09', {
      collation: c!.c,
      charset: c!.s,
      distinctBanglaVariants: Number(d!.n),
      overLimitErrno: tooLong ?? null,
    });
    expect(c!.s).toBe('utf8mb4');
    expect(Number(d!.n)).toBe(2);
    expect(tooLong).toBe(1071);
  });
});
