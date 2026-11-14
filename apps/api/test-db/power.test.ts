import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { seedDemo, seedReference } from '../src/db/demo-seed';
import type { Row } from '../src/db/pool';
import { AdminRepo } from '../src/modules/admin/repo';
import { AdminInsights, csvCell, fillDays, toCsv } from '../src/modules/admin/insights';
import { ApplicationRepo } from '../src/modules/applications/repo';
import { hashPassword } from '../src/modules/auth/crypto';
import { AuthRepo } from '../src/modules/auth/repo';
import { totpAt } from '../src/modules/auth/totp';
import { CaptureMailer } from '../src/modules/email/mailer';
import { ListingRepo } from '../src/modules/listings/repo';
import { buildConnectors } from '../src/modules/listings/sources';
import { MeRepo } from '../src/modules/me/repo';
import { OpportunityRepo } from '../src/modules/opportunities/repo';
import { RecommendService } from '../src/modules/recommend/service';
import { TestClock } from '../src/platform/clock';
import { loadConfig } from '../src/platform/config';
import { Browser } from './browser';
import { freshDatabase, type TestDb } from './helpers';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  WEB_ORIGIN: 'http://localhost:3000',
  INTERNAL_HMAC_SECRETS: 's'.repeat(40),
  EMAIL_VERIFICATION_REQUIRED: 'false',
});
const PASSWORD = 'Long-Enough-Pass1!';

const FEED = {
  data: [
    {
      slug: 'a1',
      company_name: 'Acme',
      title: 'Backend Developer',
      description: '<p>APIs</p>',
      url: 'https://www.arbeitnow.com/jobs/a1',
      tags: [],
      location: 'Berlin',
      created_at: 1760000000,
    },
    {
      slug: 'a2',
      company_name: 'Clinic',
      title: 'Registered Nurse',
      description: 'Care',
      url: 'https://www.arbeitnow.com/jobs/a2',
      tags: [],
      location: 'Munich',
      created_at: 1760000100,
    },
    {
      slug: 'a3',
      company_name: 'Studio',
      title: 'Software Engineer',
      description: 'Build software',
      url: 'https://www.arbeitnow.com/jobs/a3',
      tags: [],
      location: 'Hamburg',
      created_at: 1760000050,
    },
  ],
};

describe('personalised lists, similar opportunities and the staff power tools on TiDB', () => {
  let t: TestDb;
  let app: FastifyInstance;
  let listings: ListingRepo;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    const me = new MeRepo(t.db);
    const opps = new OpportunityRepo(t.db);
    listings = new ListingRepo(
      t.db,
      buildConnectors(),
      clock,
      async (url: string) =>
        new Response(JSON.stringify(url.includes('arbeitnow') ? FEED : { jobs: [] }), {
          status: 200,
        }),
    );
    await listings.refresh();
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer: new CaptureMailer() },
      opportunities: { repo: opps },
      me: { repo: me },
      admin: { repo: new AdminRepo(t.db) },
      applications: { repo: new ApplicationRepo(t.db) },
      recommend: { service: new RecommendService(t.db, me, opps, clock) },
      adminInsights: { insights: new AdminInsights(t.db, clock) },
      listings: { repo: listings },
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const idOf = async (slug: string) => {
    const [r] = await t.db.query<Row & { id: string }>(
      'SELECT id FROM opportunities WHERE slug = :s',
      {
        s: slug,
      },
    );
    return String(r!.id);
  };
  const user = async (email: string) => {
    const b = new Browser(app);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/register', {
      email,
      password: PASSWORD,
      display_name: 'Reader',
      age_confirmed: true,
      locale: 'en',
      consents: { terms: true, privacy: true },
    });
    expect((await b.login(email, PASSWORD)).statusCode).toBe(200);
    return b;
  };
  const staff = async (email: string, roles: string[]) => {
    const repo = new AuthRepo(t.db);
    const created = await repo.createUser({
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: await hashPassword('staff password 123'),
      displayName: 'Staff',
      locale: 'en',
      now: clock.now(),
      policyVersion: 'test',
      consents: [{ purpose: 'terms', granted: true }],
    });
    await repo.markEmailVerified(created!.id, clock.now());
    for (const r of roles) {
      await t.db.execute('INSERT INTO user_roles (user_id, role) VALUES (:id, :r)', {
        id: created!.id,
        r,
      });
    }
    const b = new Browser(app);
    await b.login(email, 'staff password 123');
    const en = await b.req('POST', '/api/v1/auth/mfa/enroll');
    await b.req('POST', '/api/v1/auth/mfa/confirm', {
      code: totpAt(en.json().data.secret as string, clock.now().getTime()),
    });
    return { b, id: String(created!.id) };
  };
  const prefs = (over: Record<string, unknown> = {}) => ({
    categories: [],
    keywords: [],
    location_slugs: [],
    alerts_enabled: true,
    personalize: true,
    ...over,
  });

  // ---------- personalised lists ----------
  it('the explore feed puts what a person likes first and says why; categories and places still filter it', async () => {
    const anon = new Browser(app);
    expect((await anon.req('GET', '/api/v1/me/feed')).statusCode).toBe(401);

    const jobs = await user('feed-jobs@example.com');
    const study = await user('feed-study@example.com');
    await jobs.req('PUT', '/api/v1/me/preferences', prefs({ categories: ['jobs'] }));
    await study.req('PUT', '/api/v1/me/preferences', prefs({ categories: ['scholarships'] }));

    const a = (await jobs.req('GET', '/api/v1/me/feed?locale=en&limit=3')).json();
    const b = (await study.req('GET', '/api/v1/me/feed?locale=en&limit=3')).json();
    expect(a.data[0].category_slug).toBe('jobs');
    expect(b.data[0].category_slug).toBe('scholarships');
    expect(a.data[0].reasons.map((r: { code: string }) => r.code)).toContain('category_interest');
    expect(a.meta.personalised).toBe(true);
    expect(a.meta.total).toBeGreaterThanOrEqual(6); // saved items are not hidden from the explore list

    const onlyJobs = (
      await study.req('GET', '/api/v1/me/feed?locale=en&category=jobs&limit=50')
    ).json();
    expect(onlyJobs.data.length).toBeGreaterThan(0);
    expect(onlyJobs.data.every((o: { category_slug: string }) => o.category_slug === 'jobs')).toBe(
      true,
    );
    expect((await study.req('GET', '/api/v1/me/feed?category=Bad Slug')).statusCode).toBe(422);
    // paging
    const p2 = (await jobs.req('GET', '/api/v1/me/feed?locale=en&limit=2&offset=2')).json();
    expect(p2.data).toHaveLength(2);
    expect(p2.data[0].id).not.toBe(a.data[0].id);
  });

  it('web jobs are ordered by the keywords a person set, without hiding the rest', async () => {
    const b = await user('webfeed@example.com');
    await b.req('PUT', '/api/v1/me/preferences', prefs({ keywords: ['nurse'] }));
    const res = (await b.req('GET', '/api/v1/me/web-jobs?limit=10')).json();
    expect(res.data[0].title).toBe('Registered Nurse');
    expect(res.data[0].reasons[0]).toMatchObject({ code: 'keyword', value: 'nurse' });
    expect(res.meta.total).toBe(3);
    expect(res.meta.personalised).toBe(true);
    const other = await user('webfeed2@example.com');
    await other.req('PUT', '/api/v1/me/preferences', prefs({ keywords: ['software'] }));
    expect((await other.req('GET', '/api/v1/me/web-jobs')).json().data[0].title).toBe(
      'Software Engineer',
    );
    expect((await other.req('GET', '/api/v1/me/web-jobs?q=nurse')).json().data).toHaveLength(1);
    expect((await new Browser(app).req('GET', '/api/v1/me/web-jobs')).statusCode).toBe(401);
  });

  it('similar opportunities: same kind first, never the opportunity itself, public', async () => {
    const jobs = await idOf('demo-assistant-programmer');
    const anon = new Browser(app);
    const res = await anon.req('GET', `/api/v1/opportunities/${jobs}/similar?locale=en`);
    expect(res.statusCode).toBe(200);
    const list = res.json().data as Array<{ id: string; category_slug: string }>;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((o) => o.id !== jobs)).toBe(true);
    expect(list[0]!.category_slug).toBe('jobs');
    expect((await anon.req('GET', '/api/v1/opportunities/999/similar')).json().data).toEqual([]);
  });

  // ---------- staff power tools ----------
  it('analytics are for people with the analytics permission and carry real numbers', async () => {
    const user1 = await user('stat-user@example.com');
    await user1.req(
      'POST',
      `/api/v1/opportunities/${await idOf('demo-assistant-programmer')}/apply`,
      { consent: true },
    );
    const editor = await staff('stat-editor@example.com', ['editor']);
    expect((await editor.b.req('GET', '/api/v1/admin/analytics')).json().error.code).toBe(
      'FORBIDDEN',
    );
    const admin = await staff('stat-admin@example.com', ['admin']);
    const res = await admin.b.req('GET', '/api/v1/admin/analytics');
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.totals.site_applications).toBe(1);
    expect(d.totals.published_opportunities).toBe(6);
    expect(d.totals.web_listings).toBe(3);
    expect(d.signups_14d).toHaveLength(14);
    expect(d.applications_14d.reduce((n: number, x: { n: number }) => n + x.n, 0)).toBe(1);
    expect(d.funnel.submitted).toBe(1);
    expect(d.top_opportunities[0].applications).toBe(1);
    expect(d.by_category.map((c: { slug: string }) => c.slug)).toEqual([
      'jobs',
      'internships',
      'scholarships',
    ]);
  });

  it('CSV export: filtered, formula-safe, audited, and only for people who may read applications', async () => {
    const evil = await user('evil@example.com');
    await t.db.execute(
      'UPDATE users SET display_name = \'=HYPERLINK("http://x")\' WHERE email_normalized = :e',
      {
        e: 'evil@example.com',
      },
    );
    await evil.req('POST', `/api/v1/opportunities/${await idOf('demo-office-assistant')}/apply`, {
      consent: true,
    });
    const admin = await staff('csv-admin@example.com', ['admin']);
    const res = await admin.b.req('GET', '/api/v1/admin/applications/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    const body = res.body.charCodeAt(0) === 0xfeff ? res.body.slice(1) : res.body;
    const lines = body.trim().split('\r\n');
    expect(lines[0]).toContain('tracking_code,status');
    expect(lines.length).toBe(3);
    expect(body).toContain("'=HYPERLINK"); // never starts a spreadsheet formula
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
    const filtered = await admin.b.req('GET', '/api/v1/admin/applications/export?status=interview');
    expect(filtered.body.trim().split('\r\n')).toHaveLength(1);
    const plain = await user('csv-plain@example.com');
    expect((await plain.req('GET', '/api/v1/admin/applications/export')).json().error.code).toBe(
      'FORBIDDEN',
    );
    const [a] = await t.db.query<Row & { n: number }>(
      "SELECT COUNT(*) n FROM audit_logs WHERE action = 'application.export'",
    );
    expect(Number(a!.n)).toBeGreaterThanOrEqual(2);
  });

  it('bulk status moves what it can, skips what it cannot and tells the applicants', async () => {
    const admin = await staff('bulk-admin@example.com', ['admin']);
    const list = (await admin.b.req('GET', '/api/v1/admin/applications?limit=10')).json()
      .data as Array<{ id: string }>;
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((x) => x.id);
    const first = await admin.b.req('POST', '/api/v1/admin/applications/bulk-status', {
      ids: [...ids, '123'],
      status: 'under_review',
      note: 'Batch review started.',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.updated).toBe(ids.length);
    expect(first.json().data.skipped).toEqual([{ id: '123', reason: 'not found' }]);
    // moving the same batch to under_review again is refused per item, not as a whole
    const again = await admin.b.req('POST', '/api/v1/admin/applications/bulk-status', {
      ids,
      status: 'under_review',
    });
    expect(again.json().data.updated).toBe(0);
    expect(again.json().data.skipped).toHaveLength(ids.length);
    expect(
      (
        await admin.b.req('POST', '/api/v1/admin/applications/bulk-status', {
          ids: [],
          status: 'accepted',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await admin.b.req('POST', '/api/v1/admin/applications/bulk-status', {
          ids,
          status: 'withdrawn',
        })
      ).statusCode,
    ).toBe(422);
    const [n] = await t.db.query<Row & { n: number }>(
      "SELECT COUNT(*) n FROM notifications WHERE type = 'application_update'",
    );
    expect(Number(n!.n)).toBe(ids.length);
  });

  it('suspending an account signs the person out and blocks sign-in; restoring lets them back; staff cannot suspend themselves', async () => {
    const admin = await staff('susp-admin@example.com', ['admin']);
    const victim = await user('victim@example.com');
    const [v] = await t.db.query<Row & { id: string }>(
      "SELECT id FROM users WHERE email_normalized = 'victim@example.com'",
    );
    expect((await victim.req('GET', '/api/v1/me')).statusCode).toBe(200);
    const res = await admin.b.req('POST', `/api/v1/admin/users/${v!.id}/status`, {
      status: 'suspended',
      reason: 'Spam',
    });
    expect(res.statusCode).toBe(204);
    expect((await victim.req('GET', '/api/v1/me')).statusCode).toBe(401);
    const again = new Browser(app);
    await again.csrf();
    expect((await again.login('victim@example.com', PASSWORD)).statusCode).not.toBe(200);
    expect(
      (await admin.b.req('POST', `/api/v1/admin/users/${v!.id}/status`, { status: 'active' }))
        .statusCode,
    ).toBe(204);
    const back = new Browser(app);
    await back.csrf();
    expect((await back.login('victim@example.com', PASSWORD)).statusCode).toBe(200);
    expect(
      (
        await admin.b.req('POST', `/api/v1/admin/users/${admin.id}/status`, { status: 'suspended' })
      ).json().error.code,
    ).toBe('FORBIDDEN');
    expect(
      (await admin.b.req('POST', '/api/v1/admin/users/999/status', { status: 'suspended' }))
        .statusCode,
    ).toBe(404);
    const plain = await user('plain-mod@example.com');
    expect(
      (
        await plain.req('POST', `/api/v1/admin/users/${v!.id}/status`, { status: 'suspended' })
      ).json().error.code,
    ).toBe('FORBIDDEN');
    const audit = await t.db.query<Row & { action: string }>(
      "SELECT action FROM audit_logs WHERE action IN ('user.suspend', 'user.restore')",
    );
    expect(audit.map((r) => r.action).sort()).toEqual(['user.restore', 'user.suspend']);
  });

  it('a broadcast reaches everyone, or only people interested in one category, once, and is audited', async () => {
    const admin = await staff('bc-admin@example.com', ['admin']);
    const editor = await staff('bc-editor@example.com', ['editor']);
    const fan = await user('bc-fan@example.com');
    const other = await user('bc-other@example.com');
    await fan.req('PUT', '/api/v1/me/preferences', prefs({ categories: ['scholarships'] }));
    expect(
      (
        await editor.b.req('POST', '/api/v1/admin/notifications/broadcast', {
          title: 'Hello',
          message: 'Hi all',
          audience: 'all',
        })
      ).json().error.code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await admin.b.req('POST', '/api/v1/admin/notifications/broadcast', {
          title: 'Hi',
          message: 'Short',
          audience: 'category',
        })
      ).statusCode,
    ).toBe(422);

    const cat = await admin.b.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'New scholarships this week',
      message: 'Check the scholarships list.',
      audience: 'category',
      category_slug: 'scholarships',
    });
    expect(cat.json().data.told).toBe(2); // the fan and the person from the feed test who chose scholarships
    const mine = (await fan.req('GET', '/api/v1/me/notifications')).json().data as Array<{
      type: string;
      params: { title?: string };
    }>;
    expect(mine.filter((n) => n.type === 'announcement').map((n) => n.params.title)).toEqual([
      'New scholarships this week',
    ]);
    expect(
      (await other.req('GET', '/api/v1/me/notifications'))
        .json()
        .data.filter((n: { type: string }) => n.type === 'announcement'),
    ).toHaveLength(0);

    const all = await admin.b.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'Maintenance tonight',
      message: 'Short break at midnight.',
      audience: 'all',
    });
    expect(all.json().data.told).toBeGreaterThanOrEqual(2);
    expect(
      (await other.req('GET', '/api/v1/me/notifications'))
        .json()
        .data.filter((n: { type: string }) => n.type === 'announcement'),
    ).toHaveLength(1);
    const [a] = await t.db.query<Row & { n: number }>(
      "SELECT COUNT(*) n FROM audit_logs WHERE action = 'notification.broadcast'",
    );
    expect(Number(a!.n)).toBe(2);
  });

  it('opportunity lists carry application and save counts', async () => {
    const admin = await staff('count-admin@example.com', ['admin']);
    const res = (await admin.b.req('GET', '/api/v1/admin/opportunities?limit=50')).json()
      .data as Array<{ slug: string; applications: number; apply_mode: string }>;
    const prog = res.find((o) => o.slug === 'demo-assistant-programmer')!;
    expect(prog.applications).toBe(1);
    expect(prog.apply_mode).toBe('both');
  });

  it('csv helpers: quoting, formula guard and day filling', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a'], [['x'], ['y']])).toBe('a\r\nx\r\ny\r\n');
    const days = fillDays([{ day: '2026-11-13', n: 2 }], new Date('2026-11-13T06:00:00Z'), 3);
    expect(days).toEqual([
      { day: '2026-11-11', n: 0 },
      { day: '2026-11-12', n: 0 },
      { day: '2026-11-13', n: 2 },
    ]);
  });
});
