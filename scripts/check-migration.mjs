// Static structural check of the generated migration (syntax only; it is NOT applied to any database).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sql = fs.readFileSync(path.join(root, 'apps', 'api', 'migrations', '0001_init.sql'), 'utf8');
const statements = sql.split(/;\s*\n/).filter((x) => /CREATE (TABLE|VIEW)/.test(x));
const problems = [];
for (const st of statements) {
  const name = /CREATE (?:TABLE|VIEW) (\w+)/.exec(st)?.[1] ?? '?';
  const body = st.replace(/--.*$/gm, '');
  let depth = 0;
  for (const c of body) {
    if (c === '(') depth++;
    if (c === ')') depth--;
  }
  if (depth !== 0) problems.push(`${name}: unbalanced parentheses`);
  if (/,\s*\)\s*$/.test(body.trim()))
    problems.push(`${name}: trailing comma before closing parenthesis`);
  if (/(^|[\s,(])(TS|CT)([\s,)]|$)/m.test(body)) problems.push(`${name}: unexpanded macro`);
  if (/\bVECTOR\b/.test(body)) problems.push(`${name}: VECTOR column (P2 only)`);
}
const stray = sql
  .split('\n')
  .filter((l) => l.trim() && !/^\s*--/.test(l))
  .filter(
    (l) =>
      !/[;,()]|^\s*(CREATE|SET|SELECT|FROM|JOIN|ON|PRIMARY|UNIQUE|KEY|CONSTRAINT)\b|^\s*\w+\s+[A-Z]+(\(\d+(,\s*\d+)?\))?\s+(NOT NULL|NULL)/.test(
        l,
      ),
  );
if (stray.length) problems.push(`stray non-SQL lines: ${stray.slice(0, 3).join(' | ')}`);
console.log(`${statements.length} statements checked.`);
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(
  'No structural problems found (static check; the apply test is apps/api/test-db/migrate.test.ts).',
);
