// Smoke crawl: follows every internal link from the given start pages and reports any that fail.
// Usage: node scripts/crawl-links.mjs http://localhost:3100 [cookie]
const base = process.argv[2] ?? 'http://localhost:3100';
let cookie = process.argv[3] ?? '';
// Optional sign-in (LOGIN_EMAIL / LOGIN_PASSWORD) so pages behind a login are crawled too.
if (process.env.LOGIN_EMAIL) {
  const jar = new Map();
  const keep = (r) => {
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const r1 = await fetch(`${base}/api/v1/auth/csrf`);
  keep(r1);
  const token = (await r1.json()).data.csrf_token;
  const r2 = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
      cookie: header(),
      origin: base,
    },
    body: JSON.stringify({ email: process.env.LOGIN_EMAIL, password: process.env.LOGIN_PASSWORD }),
  });
  keep(r2);
  console.log('login status', r2.status);
  cookie = header();
}
const seen = new Map();
const queue = [
  ...(process.env.LOGIN_EMAIL
    ? ['/en/app', '/employer', '/employer/posts', '/employer/applications', '/employer/company']
    : []),
  '/en',
  '/bn',
  '/en/register',
  '/en/sign-in',
  '/employer/login',
  '/admin/login',
  '/en/register?type=employer',
];
const bad = [];
while (queue.length && seen.size < 400) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  await new Promise((r) => setTimeout(r, 400));
  let res;
  try {
    res = await fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  } catch (e) {
    bad.push(`${path} -> fetch failed ${e.message}`);
    seen.set(path, 0);
    continue;
  }
  seen.set(path, res.status);
  if (res.status >= 400) bad.push(`${path} -> ${res.status}`);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') ?? '';
    if (loc.startsWith('/')) queue.push(loc);
    continue;
  }
  if (!(res.headers.get('content-type') ?? '').includes('html')) continue;
  const html = await res.text();
  if (/<h[12][^>]*>[^<]*(Something went wrong|This page could not be found)/.test(html))
    bad.push(`${path} -> error page body`);
  for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
    const href = m[1].replace(/&amp;/g, '&');
    if (
      href.startsWith('/_next') ||
      href.startsWith('//') ||
      /\.(svg|png|ico|css|js|txt|xml|csv)(\?|$)/.test(href)
    )
      continue;
    if (href.startsWith('/api/')) continue;
    if (!seen.has(href)) queue.push(href);
  }
}
console.log(`checked ${seen.size} pages, ${bad.length} problems`);
for (const b of bad) console.log(b);
process.exit(bad.length ? 1 : 0);
