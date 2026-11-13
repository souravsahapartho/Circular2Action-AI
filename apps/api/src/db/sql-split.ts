/**
 * Splits a SQL script into statements at top-level semicolons, ignoring semicolons inside quotes,
 * backticks, `--`/`#` line comments and block comments. Comment-only fragments are dropped.
 */
export function splitSql(src: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    // line comments
    if ((c === '-' && next === '-') || c === '#') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      buf += src.slice(i, stop);
      i = stop;
      continue;
    }
    // block comments
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      buf += src.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\' && c !== '`') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          if (src[j + 1] === c) {
            j += 2; // doubled quote
            continue;
          }
          break;
        }
        j++;
      }
      buf += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ';') {
      pushStatement(out, buf);
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  pushStatement(out, buf);
  return out;
}

function pushStatement(out: string[], raw: string): void {
  const withoutComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(--|#)[^\n]*/g, '')
    .trim();
  if (withoutComments) out.push(raw.trim());
}
