// Minimal reader/writer for the owner's git-ignored .env.local. Values are never printed.
import fs from 'node:fs';
import path from 'node:path';

export const ENV_FILE = path.resolve(import.meta.dirname, '..', '..', '.env.local');

export function readEnvFile(file = ENV_FILE) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

/** Sets or replaces KEY=value lines, keeping comments and order. */
export function writeEnvValues(values, file = ENV_FILE) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(values)) {
    const idx = lines.findIndex((l) => l.trim().startsWith(`${k}=`));
    const line = `${k}=${v}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  fs.writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

export function require(env, ...keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Missing in .env.local: ${missing.join(', ')}`);
    process.exit(2);
  }
}

/** Shows a URL with user and password removed, for logs. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//***@${u.host}${u.pathname}`;
  } catch {
    return '(invalid url)';
  }
}
