import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { seedDemo, seedReference } from '../src/db/demo-seed';
import type { Row } from '../src/db/pool';
import { AdminRepo } from '../src/modules/admin/repo';
import { ApplicationRepo } from '../src/modules/applications/repo';
import { hashPassword } from '../src/modules/auth/crypto';
import { AuthRepo } from '../src/modules/auth/repo';
import { totpAt } from '../src/modules/auth/totp';
import { CaptureMailer } from '../src/modules/email/mailer';
import { ListingRepo } from '../src/modules/listings/repo';
import { buildConnectors } from '../src/modules/listings/sources';
import { MeRepo } from '../src/modules/me/repo';
import { OpportunityRepo } from '../src/modules/opportunities/repo';
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

const FEED = {
  arbeitnow: {
    data: [
      {
        slug: 'job-a',
        company_name: 'Acme',
        title: 'Backend Developer',
        description: '<p>Write APIs</p>',
        url: 'https://www.arbeitnow.com/jobs/job-a',
        tags: ['it'],
        location: 'Berlin',
        created_at: 1760000000,
      },
      {
        slug: 'job-b',
        company_name: 'Beta',
        title: 'Nurse',
        description: 'Care',
        url: 'https://www.arbeitnow.com/jobs/job-b',
        tags: [],
        location: 'Munich',
        created_at: 1760000100,
      },
    ],
  },
  remotive: {
    jobs: [
      {
        id: 5,
        url: 'https://remotive.com/job/5',
        title: 'Remote Designer',
        company_name: 'Studio',
        category: 'Design',
        publication_date: '2026-11-01T10:00:00',
        candidate_required_location: 'Worldwide',
        description: 'Design things',
      },
    ],
  },
};

const PASSWORD = 'Long-Enough-Pass1!';

describe('portal: site applications with tracking IDs, staff handling, jobs from the web', () => {
  let t: TestDb;
  let app: FastifyInstance;
  let failFeed = false;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));
  const fakeFetch = async (url: string): Promise<Response> => {
    if (failFeed) return new Response('nope', { status: 503 });
    const body = url.includes('arbeitnow') ? FEED.arbeitnow : FEED.remotive;
    return new Response(JSON.stringify(body), { status: 200 });
  };

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer: new CaptureMailer() },
      opportunities: { repo: new OpportunityRepo(t.db) },
      me: { repo: new MeRepo(t.db) },
      admin: { repo: new AdminRepo(t.db) },
      applications: { repo: new ApplicationRepo(t.db) },
      listings: { repo: new ListingRepo(t.db, buildConnectors(), clock, fakeFetch) },
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const idOf = async (slug: string) => {
    const [r] = await t.db.query<Row & { id: string }>(
      'SELECT id FROM opportunities WHERE slug = :s',
      { s: slug },
    );
    return String(r!.id);
  };
  const user = async (email: string) => {
    const b = new Browser(app);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/register', {
      email,
      password: PASSWORD,
      display_name: 'Applicant One',
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
      displayName: 'Staff Member',
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
    return b;
  };
  const errorCode = (res: { json: () => { error?: { code?: string } } }) => res.json().error?.code;

  it('apply: only where the opportunity accepts site applications, with a tracking ID, once per person', async () => {
    const programmer = await idOf('demo-assistant-programmer'); // apply_mode both
    const hsc = await idOf('demo-hsc-merit-stipend'); // external only
    const b = await user('applicant@example.com');
    const anon = new Browser(app);
    await anon.csrf();

    const ask = (br: Browser, id: string, body: unknown) =>
      br.req('POST', `/api/v1/opportunities/${id}/apply`, body);
    expect((await ask(anon, programmer, { consent: true })).statusCode).toBe(401);
    expect((await ask(b, programmer, {})).statusCode).toBe(422); // consent missing
    expect(errorCode(await ask(b, hsc, { consent: true }))).toBe('CONFLICT');
    expect((await ask(b, '999', { consent: true })).statusCode).toBe(404);

    const res = await ask(b, programmer, {
      consent: true,
      phone: '+880 1700-000000',
      cover_note: 'I would like to apply.',
    });
    expect(res.statusCode).toBe(201);
    const first = res.json().data;
    expect(first.tracking_code).toMatch(/^C2A-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(first).toMatchObject({ status: 'submitted', existing: false });

    // applying again returns the same code instead of a second application
    const again = await ask(b, programmer, { consent: true });
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toMatchObject({ tracking_code: first.tracking_code, existing: true });
    const [n] = await t.db.query<Row & { n: number }>('SELECT COUNT(*) n FROM site_applications');
    expect(Number(n!.n)).toBe(1);

    // the applicant sees it, with the timeline
    const mine = (await b.req('GET', '/api/v1/me/site-applications')).json().data;
    expect(mine).toHaveLength(1);
    const detail = (await b.req('GET', `/api/v1/me/site-applications/${mine[0].id}`)).json().data;
    expect(detail.timeline.map((e: { to_status: string }) => e.to_status)).toEqual(['submitted']);
    expect(detail.eligibility_status).toBeTruthy();

    // someone else cannot read or withdraw it
    const other = await user('other@example.com');
    expect((await other.req('GET', `/api/v1/me/site-applications/${mine[0].id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await other.req('POST', `/api/v1/me/site-applications/${mine[0].id}/withdraw`)).statusCode,
    ).toBe(404);
  });

  it('public tracking: found by code in any casing, no personal data, unknown codes are 404', async () => {
    const [row] = await t.db.query<Row & { tracking_code: string }>(
      'SELECT tracking_code FROM site_applications',
    );
    const anon = new Browser(app);
    const res = await anon.req('GET', `/api/v1/track/${row!.tracking_code.toLowerCase()}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(res.json().data).toMatchObject({
      tracking_code: row!.tracking_code,
      status: 'submitted',
    });
    expect(body).not.toContain('applicant@example.com');
    expect(body).not.toContain('Applicant One');
    expect(body).not.toContain('880');
    expect((await anon.req('GET', '/api/v1/track/C2A-AAAA-BBBB')).statusCode).toBe(404);
    expect((await anon.req('GET', '/api/v1/track/not-a-code')).statusCode).toBe(404);
  });

  it('staff handle applications: permissions, valid transitions, public timeline, audit trail', async () => {
    const editor = await staff('editor-portal@example.com', ['editor']);
    const plain = await user('nostaff@example.com');
    expect(errorCode(await plain.req('GET', '/api/v1/admin/applications'))).toBe('FORBIDDEN');

    const list = await editor.req('GET', '/api/v1/admin/applications');
    expect(list.statusCode).toBe(200);
    expect(list.json().meta.counts.submitted).toBe(1);
    const a = list.json().data[0];
    expect(a).toMatchObject({ applicant_email: 'applicant@example.com', status: 'submitted' });

    expect(
      (await editor.req('GET', '/api/v1/admin/applications?status=interview')).json().data,
    ).toHaveLength(0);
    expect(
      (await editor.req('GET', '/api/v1/admin/applications?q=applicant%40example')).json().data,
    ).toHaveLength(1);

    const full = (await editor.req('GET', `/api/v1/admin/applications/${a.id}`)).json().data;
    expect(full.cover_note).toBe('I would like to apply.');
    expect(full.profile_snapshot.eligibility).toBeTruthy();

    const status = (to: string, extra: Record<string, unknown> = {}) => {
      clock.advanceMs(60_000);
      return editor.req('POST', `/api/v1/admin/applications/${a.id}/status`, {
        status: to,
        ...extra,
      });
    };
    // submitted -> accepted is not allowed; submitted -> under_review is
    expect(errorCode(await status('accepted'))).toBe('CONFLICT');
    expect((await status('withdrawn')).statusCode).toBe(422);
    expect(
      (await status('under_review', { note: 'We are reading your application.' })).statusCode,
    ).toBe(200);
    // a private note is not shown to the applicant or on the tracking page
    await status('shortlisted', {
      note: 'Strong candidate, internal only.',
      visible_to_applicant: false,
    });
    expect(
      (
        await editor.req('PUT', `/api/v1/admin/applications/${a.id}/note`, {
          note: 'Call on Sunday',
        })
      ).statusCode,
    ).toBe(200);

    const adminView = (await editor.req('GET', `/api/v1/admin/applications/${a.id}`)).json().data;
    expect(adminView.timeline.map((e: { to_status: string }) => e.to_status)).toEqual([
      'submitted',
      'under_review',
      'shortlisted',
    ]);
    expect(adminView.admin_note).toBe('Call on Sunday');

    const [code] = await t.db.query<Row & { tracking_code: string }>(
      'SELECT tracking_code FROM site_applications',
    );
    const pub = JSON.stringify(
      (await new Browser(app).req('GET', `/api/v1/track/${code!.tracking_code}`)).json(),
    );
    expect(pub).toContain('We are reading your application.');
    expect(pub).not.toContain('internal only');
    expect(pub).not.toContain('Call on Sunday');
    expect(pub).toContain('shortlisted');

    const audit = await t.db.query<Row & { action: string }>(
      "SELECT action FROM audit_logs WHERE target_type = 'site_application' ORDER BY id",
    );
    expect(audit.map((r) => r.action).sort()).toEqual([
      'application.note',
      'application.status',
      'application.status',
    ]);
  });

  it('the applicant can withdraw; a closed application cannot be changed by either side', async () => {
    const editor = await staff('editor2-portal@example.com', ['editor']);
    const b = new Browser(app);
    await b.csrf();
    expect((await b.login('applicant@example.com', PASSWORD)).statusCode).toBe(200);
    const [mine] = (await b.req('GET', '/api/v1/me/site-applications')).json().data;
    const done = await b.req('POST', `/api/v1/me/site-applications/${mine.id}/withdraw`);
    expect(done.statusCode).toBe(200);
    expect(errorCode(await b.req('POST', `/api/v1/me/site-applications/${mine.id}/withdraw`))).toBe(
      'CONFLICT',
    );
    expect(
      errorCode(
        await editor.req('POST', `/api/v1/admin/applications/${mine.id}/status`, {
          status: 'rejected',
        }),
      ),
    ).toBe('CONFLICT');
  });

  it('apply_mode can be set by staff and shows on the public detail', async () => {
    const editor = await staff('editor3-portal@example.com', ['editor']);
    const id = await idOf('demo-masters-scholarship');
    const get = (await editor.req('GET', `/api/v1/admin/opportunities/${id}`)).json().data;
    expect(get.apply_mode).toBe('external');
    const patched = await editor.req('PATCH', `/api/v1/admin/opportunities/${id}`, {
      apply_mode: 'both',
      updated_at: get.updated_at,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.apply_mode).toBe('both');
    const pub = (await new Browser(app).req('GET', `/api/v1/opportunities/${id}?locale=en`)).json()
      .data;
    expect(pub.apply_mode).toBe('both');
  });

  it('jobs from the web: refresh stores them once, public list is labelled by source, hide removes one, failures are recorded', async () => {
    const admin = await staff('admin-portal@example.com', ['admin']);
    const anon = new Browser(app);
    expect((await anon.req('GET', '/api/v1/admin/listings')).statusCode).toBe(401);
    const editor = await staff('editor4-portal@example.com', ['editor']);
    expect(errorCode(await editor.req('GET', '/api/v1/admin/listings'))).toBe('FORBIDDEN');

    const first = await admin.req('POST', '/api/v1/admin/listings/refresh', {});
    expect(first.statusCode).toBe(200);
    const sources = first.json().data.sources as Array<{
      id: string;
      enabled: boolean;
      listings: number;
      needs: string | null;
    }>;
    expect(sources.find((s) => s.id === 'arbeitnow')).toMatchObject({
      enabled: true,
      listings: 2,
    });
    expect(sources.find((s) => s.id === 'remotive')).toMatchObject({ enabled: true, listings: 1 });
    expect(sources.find((s) => s.id === 'google')).toMatchObject({
      enabled: false,
      needs: 'GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX',
    });

    // refreshing again does not duplicate
    await admin.req('POST', '/api/v1/admin/listings/refresh', { source: 'arbeitnow' });
    const [n] = await t.db.query<Row & { n: number }>('SELECT COUNT(*) n FROM external_listings');
    expect(Number(n!.n)).toBe(3);

    const pub = (await anon.req('GET', '/api/v1/listings?limit=10')).json();
    expect(pub.meta.total).toBe(3);
    expect(pub.data[0]).toHaveProperty('source');
    expect(pub.data[0]).not.toHaveProperty('hidden');
    expect((await anon.req('GET', '/api/v1/listings?q=nurse')).json().data).toHaveLength(1);
    expect((await anon.req('GET', '/api/v1/listings?source=remotive')).json().data).toHaveLength(1);
    expect((await anon.req('GET', '/api/v1/listings?source=bogus')).statusCode).toBe(422);
    const srcList = (await anon.req('GET', '/api/v1/listings/sources')).json().data;
    expect(srcList.map((s: { id: string }) => s.id).sort()).toEqual(['arbeitnow', 'remotive']);

    // hide one
    const nurse = pub.data.find((l: { title: string }) => l.title === 'Nurse');
    expect(
      (await admin.req('POST', `/api/v1/admin/listings/${nurse.id}/hidden`, { hidden: true }))
        .statusCode,
    ).toBe(200);
    expect((await anon.req('GET', '/api/v1/listings?q=nurse')).json().data).toHaveLength(0);
    expect((await admin.req('GET', '/api/v1/admin/listings?q=nurse')).json().data[0].hidden).toBe(
      true,
    );
    // a refresh does not un-hide it
    await admin.req('POST', '/api/v1/admin/listings/refresh', {});
    expect((await anon.req('GET', '/api/v1/listings?q=nurse')).json().data).toHaveLength(0);

    // a failing source is recorded, not thrown
    failFeed = true;
    const bad = await admin.req('POST', '/api/v1/admin/listings/refresh', { source: 'remotive' });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().data.results[0]).toMatchObject({ source: 'remotive', ok: false });
    failFeed = false;
    const audit = await t.db.query<Row & { action: string }>(
      "SELECT action FROM audit_logs WHERE action LIKE 'listing.%'",
    );
    expect(audit.length).toBeGreaterThanOrEqual(4);
  });
});
