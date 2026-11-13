// Interactive, hidden-input helper: writes the two owner secrets into the git-ignored .env.local.
// Nothing is echoed to the screen, to logs or to chat. Run it yourself in a terminal:
//   node scripts/provision/setup-secrets.mjs
import readline from 'node:readline';
import { readEnvFile, writeEnvValues, ENV_FILE } from './envfile.mjs';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl._writeToOutput = (s) => {
      // print the prompt, never the typed characters
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function checkTidbUrl(v) {
  try {
    const u = new URL(v);
    if (u.protocol !== 'mysql:') return 'must start with mysql://';
    if (!/tidbcloud\.com$/.test(u.hostname)) return 'host should end with tidbcloud.com';
    if (!u.username || !u.password) return 'user and password are missing';
    return null;
  } catch {
    return 'not a valid URL (it must be one line, no spaces)';
  }
}

const current = readEnvFile();
console.log(`Secrets are written to ${ENV_FILE} (git-ignored). Typing is hidden.\n`);

console.log(
  '1) TiDB Cloud > c2a-staging > Connect > Generate Password > copy the mysql:// connection string.',
);
console.log('   (The database name at the end may be /test; the script changes it.)');
const tidb = await askHidden('Paste TiDB connection string, then Enter: ');
if (tidb) {
  const problem = checkTidbUrl(tidb);
  if (problem) {
    console.error(`TiDB string rejected: ${problem}`);
    process.exit(1);
  }
  writeEnvValues({ TIDB_ROOT_URL: tidb });
  console.log('   saved TIDB_ROOT_URL');
} else if (!current.TIDB_ROOT_URL) {
  console.error('No TiDB string given and none saved.');
  process.exit(1);
}

console.log(
  '\n2) dashboard.render.com > Account Settings > API Keys > Create API Key (starts with rnd_).',
);
const render = await askHidden('Paste Render API key, then Enter: ');
if (render) {
  if (!/^rnd_[A-Za-z0-9]{10,}$/.test(render)) {
    console.error('Render key rejected: it should look like rnd_xxxxxxxx');
    process.exit(1);
  }
  writeEnvValues({ RENDER_API_KEY: render });
  console.log('   saved RENDER_API_KEY');
} else if (!current.RENDER_API_KEY) {
  console.error('No Render key given and none saved.');
  process.exit(1);
}
console.log('\nDone. Tell Claude "secrets saved".');
