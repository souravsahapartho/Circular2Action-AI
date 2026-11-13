// One-shot staging provisioning (plan section 25.1, gates S-3 and S-9). Reads .env.local; never prints a secret.
//   1. connects to TiDB Cloud Starter with the root URL, creates c2a_staging and two users (DDL "migrate", DML "app")
//   2. applies the migrations with the DDL user, from this machine
//   3. sets DATABASE_URL (DML-only user) on the Render service and removes DDL rights from the runtime
//   4. changes the Render start command to run the API only (migrations are not run by the runtime user)
//   5. triggers a deploy and waits for it to go live, then checks /healthz and /readyz
// Usage: node scripts/provision/provision-staging.mjs
import { readEnvFile, redactUrl, require as need } from './envfile.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? 'srv-dbram23tqb8s73e0lr3g';
const SERVICE_URL = 'https://c2a-api-staging.onrender.com';
const env = readEnvFile();
need(env, 'TIDB_ROOT_URL', 'RENDER_API_KEY');

const root = path.resolve(import.meta.dirname, '..', '..');
const run = (script) =>
  execFileSync(process.execPath, [path.join(root, 'scripts', 'provision', script)], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

// 1) users and database (writes DATABASE_URL, DATABASE_MIGRATION_URL, DATABASE_TLS into .env.local)
run('tidb-setup.mjs');
const after = readEnvFile();
need(after, 'DATABASE_URL', 'DATABASE_MIGRATION_URL');

// 2) migrations with the DDL user
console.warn('applying migrations with the DDL user ...');
execFileSync(
  process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
  ['pnpm@9.15.0', '--filter', '@c2a/api', 'migrate'],
  {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: after.DATABASE_MIGRATION_URL,
      DATABASE_TLS: 'true',
    },
    shell: process.platform === 'win32',
  },
);

// 3) and 4) Render
const api = async (method, url, body) => {
  const res = await fetch(`https://api.render.com/v1${url}`, {
    method,
    headers: {
      authorization: `Bearer ${env.RENDER_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`Render API ${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const svc = await api('GET', `/services/${SERVICE_ID}`);
console.warn(`render service: ${svc.name} (${svc.serviceDetails?.region ?? '?'})`);

await api('PUT', `/services/${SERVICE_ID}/env-vars/DATABASE_URL`, { value: after.DATABASE_URL });
console.warn(`set DATABASE_URL on Render (${redactUrl(after.DATABASE_URL)})`);

await api('PATCH', `/services/${SERVICE_ID}`, {
  serviceDetails: { envSpecificDetails: { startCommand: 'pnpm --filter @c2a/api start' } },
});
console.warn('start command: pnpm --filter @c2a/api start (no migrations at runtime)');

// 5) deploy and wait
const dep = await api('POST', `/services/${SERVICE_ID}/deploys`, { clearCache: 'do_not_clear' });
console.warn(`deploy ${dep.id} started`);
let status = '';
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const d = await api('GET', `/services/${SERVICE_ID}/deploys/${dep.id}`);
  if (d.status !== status) console.warn(`  deploy status: ${d.status}`);
  status = d.status;
  if (['live', 'build_failed', 'update_failed', 'canceled', 'deactivated'].includes(status)) break;
}
if (status !== 'live') {
  console.error(`deploy did not go live (status ${status}). Check Render logs.`);
  process.exit(1);
}
for (const p of ['/healthz', '/readyz']) {
  try {
    const r = await fetch(`${SERVICE_URL}${p}`, { signal: AbortSignal.timeout(90_000) });
    console.warn(`${p} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  } catch (e) {
    console.warn(`${p} unreachable from this machine: ${e.cause?.code ?? e.message}`);
  }
}
console.warn('provisioning finished');
