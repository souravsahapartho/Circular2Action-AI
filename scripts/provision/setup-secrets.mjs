// Interactive, hidden-input helper: writes the owner secrets into the git-ignored .env.local.
// Nothing is echoed to the screen, to logs or to chat. Run it yourself in a terminal:
//   node scripts/provision/setup-secrets.mjs
import readline from 'node:readline';
import { readEnvFile, writeEnvValues, ENV_FILE } from './envfile.mjs';

const HOST = 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com';
const USER = '48XkvkofDwuiRn3.root';

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
    if (decodeURIComponent(u.password).includes('<PASSWORD>')) {
      return 'it still contains the placeholder <PASSWORD>: click Generate Password first, then copy';
    }
    return null;
  } catch {
    return 'not a valid URL (it must be one line, no spaces)';
  }
}

const current = readEnvFile();
console.log(`Secrets are written to ${ENV_FILE} (git-ignored). Typing is hidden.\n`);

console.log('1) TiDB Cloud > c2a-staging > Connect > Generate Password.');
console.log('   Copy the password next to "Generated! Password:" (or the full mysql:// string).');
const tidbInput = await askHidden('Paste the TiDB password, then Enter: ');
if (tidbInput) {
  let value = tidbInput;
  if (!tidbInput.startsWith('mysql://')) {
    // bare password: build the URL from the known host and user
    if (/\s/.test(tidbInput) || tidbInput.length < 8) {
      console.error('That does not look like a password (spaces or too short).');
      process.exit(1);
    }
    if (tidbInput.includes('<PASSWORD>')) {
      console.error('That is the placeholder. Click Generate Password first, then copy.');
      process.exit(1);
    }
    const u = new URL(`mysql://${HOST}:4000/test`);
    u.username = USER;
    u.password = tidbInput;
    value = u.toString();
  }
  const problem = checkTidbUrl(value);
  if (problem) {
    console.error(`TiDB value rejected: ${problem}`);
    process.exit(1);
  }
  writeEnvValues({ TIDB_ROOT_URL: value });
  console.log('   saved TIDB_ROOT_URL');
} else if (!current.TIDB_ROOT_URL) {
  console.error('No TiDB value given and none saved.');
  process.exit(1);
}

if (!current.RENDER_API_KEY) {
  console.log('\n2) dashboard.render.com > Account Settings > API Keys (starts with rnd_).');
  const render = await askHidden('Paste Render API key, then Enter: ');
  if (!/^rnd_[A-Za-z0-9]{10,}$/.test(render)) {
    console.error('Render key rejected: it should look like rnd_xxxxxxxx');
    process.exit(1);
  }
  writeEnvValues({ RENDER_API_KEY: render });
  console.log('   saved RENDER_API_KEY');
} else {
  console.log('\nRender API key is already saved.');
}
console.log('\nDone. Tell Claude "secrets saved".');
