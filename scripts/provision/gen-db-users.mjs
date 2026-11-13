// Generates fresh passwords for the two staging database users and the SQL that creates them.
// Use when the TiDB root password is not available: run the SQL in the TiDB Cloud SQL Editor (already signed in),
// then run scripts/provision/provision-staging.mjs, which detects the existing users.
// Writes DATABASE_URL (DML only) and DATABASE_MIGRATION_URL (DDL) into the git-ignored .env.local.
// Usage: node scripts/provision/gen-db-users.mjs <output-sql-file>
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { writeEnvValues } from './envfile.mjs';

const HOST = 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com';
const PREFIX = '48XkvkofDwuiRn3'; // TiDB Starter user prefix (not secret)
const DB = 'c2a_staging';
const out = process.argv[2];
if (!out) {
  console.error('usage: gen-db-users.mjs <output-sql-file>');
  process.exit(2);
}

const pw = () => randomBytes(18).toString('base64url');
const users = {
  migrate: { name: `${PREFIX}.c2a_migrate`, password: pw(), grants: 'ALL PRIVILEGES' },
  app: { name: `${PREFIX}.c2a_app`, password: pw(), grants: 'SELECT, INSERT, UPDATE, DELETE' },
};

const url = (u) => {
  const x = new URL(`mysql://${HOST}:4000/${DB}`);
  x.username = u.name;
  x.password = u.password;
  return x.toString();
};

const sql = [
  `CREATE DATABASE IF NOT EXISTS ${DB};`,
  ...Object.values(users).flatMap((u) => [
    `CREATE USER IF NOT EXISTS '${u.name}'@'%' IDENTIFIED BY '${u.password}';`,
    `ALTER USER '${u.name}'@'%' IDENTIFIED BY '${u.password}';`,
    `GRANT ${u.grants} ON ${DB}.* TO '${u.name}'@'%';`,
  ]),
].join('\n');

fs.writeFileSync(out, sql + '\n', { mode: 0o600 });
writeEnvValues({
  DATABASE_URL: url(users.app),
  DATABASE_MIGRATION_URL: url(users.migrate),
  DATABASE_TLS: 'true',
});
console.log(`wrote ${out} and DATABASE_URL, DATABASE_MIGRATION_URL, DATABASE_TLS to .env.local`);
