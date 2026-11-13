// Creates the staging database and two SQL users on the TiDB Cloud Starter instance (plan DBC-06, T-12):
//   <prefix>.c2a_migrate  DDL + DML on c2a_staging (used only by the migration command)
//   <prefix>.c2a_app      DML only on c2a_staging (the API runtime user)
// Reads TIDB_ROOT_URL from .env.local; writes DATABASE_URL and DATABASE_MIGRATION_URL back to .env.local.
// Passwords are generated here and never printed. Re-running rotates both passwords.
// Usage: node scripts/provision/tidb-setup.mjs
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readEnvFile, redactUrl, require as need, writeEnvValues } from './envfile.mjs';

const req = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mysql = req('mysql2/promise');

const DB = 'c2a_staging';
const env = readEnvFile();
need(env, 'TIDB_ROOT_URL');

const root = new URL(env.TIDB_ROOT_URL);
root.search = '';
const rootUser = decodeURIComponent(root.username);
const prefix = rootUser.includes('.') ? rootUser.split('.')[0] : '';
const name = (u) => (prefix ? `${prefix}.${u}` : u);
const pw = () => randomBytes(24).toString('base64url');

const conn = await mysql.createConnection({
  host: root.hostname,
  port: Number(root.port || 4000),
  user: rootUser,
  password: decodeURIComponent(root.password),
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
});
const [[ver]] = await conn.query('SELECT tidb_version() AS v');
console.warn(`connected to ${redactUrl(root.toString())}`);
console.warn(String(ver.v).split('\n').slice(0, 2).join(' | '));

await conn.query(`CREATE DATABASE IF NOT EXISTS ${DB}`);
const users = {
  migrate: { user: name('c2a_migrate'), password: pw(), grants: 'ALL PRIVILEGES' },
  app: { user: name('c2a_app'), password: pw(), grants: 'SELECT, INSERT, UPDATE, DELETE' },
};
for (const u of Object.values(users)) {
  await conn.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [u.user, u.password]);
  await conn.query(`ALTER USER ?@'%' IDENTIFIED BY ?`, [u.user, u.password]);
  await conn.query(`GRANT ${u.grants} ON ${DB}.* TO ?@'%'`, [u.user]);
  console.warn(`user ${u.user}: ${u.grants} on ${DB}.*`);
}
await conn.end();

const url = (u) => {
  const x = new URL(root.toString());
  x.username = encodeURIComponent(u.user);
  x.password = encodeURIComponent(u.password);
  x.pathname = `/${DB}`;
  return x.toString();
};
const serverRoot = new URL(root.toString());
serverRoot.pathname = '/';
writeEnvValues({
  DATABASE_URL: url(users.app),
  DATABASE_MIGRATION_URL: url(users.migrate),
  DATABASE_TLS: 'true',
  // for the S-3 suite against Starter (creates and drops its own scratch databases)
  TEST_DATABASE_URL_CLOUD: serverRoot.toString(),
});
console.warn(
  'wrote DATABASE_URL, DATABASE_MIGRATION_URL, DATABASE_TLS, TEST_DATABASE_URL_CLOUD to .env.local',
);
