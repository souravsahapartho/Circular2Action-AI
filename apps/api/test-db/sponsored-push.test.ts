import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { seedDemo, seedReference } from '../src/db/demo-seed';
import { AdminInsights } from '../src/modules/admin/insights';
import { AdminRepo } from '../src/modules/admin/repo';
import { ApplicationRepo } from '../src/modules/applications/repo';
import { hashPassword } from '../src/modules/auth/crypto';
import { AuthRepo } from '../src/modules/auth/repo';
import { totpAt } from '../src/modules/auth/totp';
import { CaptureMailer } from '../src/modules/email/mailer';
import { EmployerRepo } from '../src/modules/employer/repo';
import { MeRepo } from '../src/modules/me/repo';
import { OpportunityRepo } from '../src/modules/opportunities/repo';
import { PushService } from '../src/modules/push/service';
import { RecommendService } from '../src/modules/recommend/service';
import { SponsoredRepo } from '../src/modules/sponsored/repo';
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
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const KEYS = { p256dh: 'B'.repeat(65), auth: 'a'.repeat(22) };

describe('sponsored posts, push notifications and the notification board', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));
  const sent: Array<{ endpoint: string; payload: { title: string; body: string; url: string } }> =
    [];
  let failWith: number | null = null;

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    const me = new MeRepo(t.db);
    const opps = new OpportunityRepo(t.db);
    const adminRepo = new AdminRepo(t.db);
    const push = new PushService(t.db, clock, {}, async (sub, payload) => {
      if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer: new CaptureMailer() },
      opportunities: { repo: opps },
      me: { repo: me },
      admin: { repo: adminRepo },
      applications: { repo: new ApplicationRepo(t.db) },
      employer: { repo: new EmployerRepo(t.db, adminRepo, clock) },
      recommend: { service: new RecommendService(t.db, me, opps, clock) },
      adminInsights: { insights: new AdminInsights(t.db, clock) },
      sponsored: { repo: new SponsoredRepo(t.db, clock) },
      push: { service: push },
    });
    (globalThis as { __push?: PushService }).__push = push;
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });
  const push = () => (globalThis as unknown as { __push: PushService }).__push;

  const signup = async (email: string, extra: Record<string, unknown> = {}, locale = 'en') => {
    const b = new Browser(app);
    await b.csrf();
    const res = await b.req('POST', '/api/v1/auth/register', {
      email,
      password: PASSWORD,
      display_name: 'Test Person',
      age_confirmed: true,
      locale,
      consents: { terms: true, privacy: true },
      ...extra,
    });
    expect(res.statusCode).toBe(202);
    expect((await b.login(email, PASSWORD)).statusCode).toBe(200);
    return b;
  };
  const employer = (email: string, company: string) =>
    signup(email, { account_type: 'employer', company_name: company });
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
    return b;
  };
  const publishedPost = async (e: Browser, v: Browser, title: string) => {
    const created = await e.req('POST', '/api/v1/employer/opportunities', {
      title,
      category_slug: 'jobs',
      summary_en: 'Build things with our team.',
      deadline_date: '2026-12-30',
      vacancies: 1,
      apply_mode: 'site',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    await e.req('POST', `/api/v1/employer/opportunities/${id}/submit`);
    expect((await v.req('POST', `/api/v1/admin/opportunities/${id}/publish`, {})).statusCode).toBe(
      200,
    );
    return id;
  };

  it('sponsored: employers ask, staff decide, the post is shown labelled, counted, and expires', async () => {
    const e = await employer('sp-emp1@example.com', 'Sponsor Co');
    const other = await employer('sp-emp2@example.com', 'Other Co');
    const verifier = await staff('sp-ver@example.com', ['verifier']);
    const admin = await staff('sp-admin@example.com', ['admin']);

    // a draft cannot be sponsored
    const draft = (
      await e.req('POST', '/api/v1/employer/opportunities', {
        title: 'Draft only',
        category_slug: 'jobs',
        summary_en: 'x',
        apply_mode: 'site',
      })
    ).json().data.id as string;
    expect(
      (await e.req('POST', `/api/v1/employer/opportunities/${draft}/sponsor`, { days: 7 })).json()
        .error.code,
    ).toBe('CONFLICT');

    const id = await publishedPost(e, verifier, 'Urgent: Site Engineer');
    // only the listed durations; only the owner
    expect(
      (await e.req('POST', `/api/v1/employer/opportunities/${id}/sponsor`, { days: 5 })).statusCode,
    ).toBe(422);
    expect(
      (await other.req('POST', `/api/v1/employer/opportunities/${id}/sponsor`, { days: 7 }))
        .statusCode,
    ).toBe(404);
    const asked = await e.req('POST', `/api/v1/employer/opportunities/${id}/sponsor`, { days: 7 });
    expect(asked.statusCode).toBe(201);
    expect(
      (await e.req('POST', `/api/v1/employer/opportunities/${id}/sponsor`, { days: 3 })).json()
        .error.code,
    ).toBe('CONFLICT');

    // pending: not shown to anyone
    const anon = new Browser(app);
    expect((await anon.req('GET', '/api/v1/sponsored?locale=en')).json().data).toEqual([]);

    // a verifier cannot decide (needs listing.manage); an admin can
    expect((await verifier.req('GET', '/api/v1/admin/sponsorships')).statusCode).toBe(403);
    const pending = (await admin.req('GET', '/api/v1/admin/sponsorships?status=pending')).json()
      .data as Array<{ id: string; title: string; owner: string }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ title: 'Urgent: Site Engineer' });
    const sid = pending[0]!.id;
    expect(
      (await e.req('POST', `/api/v1/admin/sponsorships/${sid}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(403); // an employer cannot approve their own
    const ok = await admin.req('POST', `/api/v1/admin/sponsorships/${sid}/decision`, {
      decision: 'approve',
      note: 'Looks good',
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (
        await admin.req('POST', `/api/v1/admin/sponsorships/${sid}/decision`, {
          decision: 'reject',
        })
      ).json().error.code,
    ).toBe('CONFLICT');

    // the employer is told in the app
    const notes = (await e.req('GET', '/api/v1/me/notifications?limit=10')).json().data as Array<{
      type: string;
      params: { title?: string };
    }>;
    expect(notes.some((n) => n.params.title === 'Your sponsored post is live')).toBe(true);

    // shown, labelled, counted
    const shown = (await anon.req('GET', '/api/v1/sponsored?locale=en&limit=2')).json()
      .data as Array<{
      id: string;
      sponsored: boolean;
    }>;
    expect(shown.map((s) => s.id)).toEqual([id]);
    expect(shown[0]!.sponsored).toBe(true);
    await anon.csrf();
    expect((await anon.req('POST', `/api/v1/sponsored/${id}/click`, {})).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const mine = (await e.req('GET', '/api/v1/employer/sponsorships')).json().data as Array<{
      status: string;
      impressions: number;
      clicks: number;
    }>;
    expect(mine[0]).toMatchObject({ status: 'active', clicks: 1 });
    expect(mine[0]!.impressions).toBeGreaterThanOrEqual(1);

    // a person who likes this kind of job gets it with the reasons, ranked first
    const seeker = await signup('sp-seeker@example.com');
    await seeker.req('PUT', '/api/v1/me/preferences', {
      categories: ['jobs'],
      keywords: ['engineer'],
      location_slugs: [],
      alerts_enabled: true,
      personalize: true,
    });
    const mineFeed = (await seeker.req('GET', '/api/v1/me/sponsored?locale=en')).json()
      .data as Array<{
      id: string;
      reasons: unknown[];
    }>;
    expect(mineFeed.map((s) => s.id)).toContain(id);

    // it stops by itself when the time is up
    clock.set(new Date(clock.now().getTime() + 8 * 86_400_000));
    expect((await anon.req('GET', '/api/v1/sponsored?locale=en')).json().data).toEqual([]);
    clock.set(new Date('2026-11-13T06:00:00Z'));
    await t.db.execute("UPDATE sponsorships SET status = 'ended'"); // keep the next test independent
  });

  it('sponsored: declined requests and early stop; staff can start a demo sponsor at once', async () => {
    const e = await employer('sp-emp3@example.com', 'Third Co');
    const verifier = await staff('sp-ver2@example.com', ['verifier']);
    const admin = await staff('sp-admin2@example.com', ['admin']);
    const id = await publishedPost(e, verifier, 'Marketing Intern');
    await e.req('POST', `/api/v1/employer/opportunities/${id}/sponsor`, { days: 3 });
    const sid = (
      (await admin.req('GET', '/api/v1/admin/sponsorships?status=pending')).json().data as Array<{
        id: string;
      }>
    )[0]!.id;
    expect(
      (
        await admin.req('POST', `/api/v1/admin/sponsorships/${sid}/decision`, {
          decision: 'reject',
          note: 'Not now',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      ((await new Browser(app).req('GET', '/api/v1/sponsored?locale=en')).json().data as unknown[])
        .length,
    ).toBe(0);

    // staff start one directly, the employer ends it
    expect(
      (await admin.req('POST', `/api/v1/admin/opportunities/${id}/sponsor`, { days: 3 }))
        .statusCode,
    ).toBe(201);
    const list = (await e.req('GET', '/api/v1/employer/sponsorships')).json().data as Array<{
      id: string;
      status: string;
    }>;
    const active = list.find((x) => x.status === 'active')!;
    expect(
      ((await new Browser(app).req('GET', '/api/v1/sponsored?locale=en')).json().data as unknown[])
        .length,
    ).toBe(1);
    expect(
      (await e.req('POST', `/api/v1/employer/sponsorships/${active.id}/end`, {})).statusCode,
    ).toBe(200);
    expect(
      ((await new Browser(app).req('GET', '/api/v1/sponsored?locale=en')).json().data as unknown[])
        .length,
    ).toBe(0);
  });

  it('push: only real push services are accepted; unread notifications are sent once, in the person’s language; types can be switched off', async () => {
    const b = await signup('push-bn@example.com', {}, 'bn');
    const cfg = (await b.req('GET', '/api/v1/me/push')).json().data;
    expect(cfg).toMatchObject({ available: true, devices: 0 });

    // SSRF guard: an arbitrary host is refused
    for (const bad of [
      'https://evil.example/push',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://user:pw@fcm.googleapis.com/x',
    ]) {
      const r = await b.req('POST', '/api/v1/me/push/subscribe', { endpoint: bad, keys: KEYS });
      expect(r.statusCode, bad).toBe(422);
    }
    expect(
      (await b.req('POST', '/api/v1/me/push/subscribe', { endpoint: ENDPOINT, keys: KEYS }))
        .statusCode,
    ).toBe(200);
    expect((await b.req('GET', '/api/v1/me/push')).json().data.devices).toBe(1);
    // same device again does not duplicate
    await b.req('POST', '/api/v1/me/push/subscribe', { endpoint: ENDPOINT, keys: KEYS });
    expect((await b.req('GET', '/api/v1/me/push')).json().data.devices).toBe(1);

    const admin = await staff('push-admin@example.com', ['admin']);
    const told = await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'Welcome',
      message: 'Hello everyone',
      audience: 'seekers',
    });
    expect(told.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 300)); // the board also triggers a flush at once
    await push().flush();
    expect(sent.filter((s) => s.endpoint === ENDPOINT)).toHaveLength(1);
    expect(sent.find((s) => s.endpoint === ENDPOINT)!.payload).toMatchObject({
      title: 'Welcome',
      body: 'Hello everyone',
    });
    // sent once only
    await push().flush();
    expect(sent.filter((s) => s.endpoint === ENDPOINT)).toHaveLength(1);

    // a type switched off is not pushed (it still appears in the app)
    expect(
      (await b.req('PUT', '/api/v1/me/push/types', { type: 'announcement', enabled: false })).json()
        .data.disabled_types,
    ).toEqual(['announcement']);
    await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'Second',
      message: 'Quiet one',
      audience: 'seekers',
    });
    sent.length = 0;
    await new Promise((r) => setTimeout(r, 300));
    await push().flush();
    expect(sent).toHaveLength(0);
    const inApp = (await b.req('GET', '/api/v1/me/notifications?limit=10')).json().data as Array<{
      params: { title?: string };
    }>;
    expect(inApp.some((n) => n.params.title === 'Second')).toBe(true);

    // a gone device (410) is forgotten
    await b.req('PUT', '/api/v1/me/push/types', { type: 'announcement', enabled: true });
    failWith = 410;
    await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'Third',
      message: 'Device is gone',
      audience: 'seekers',
    });
    // the push goes out in the background after the broadcast; wait until the gone device has been forgotten
    for (let i = 0; i < 50; i++) {
      await push().flush();
      if ((await b.req('GET', '/api/v1/me/push')).json().data.devices === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    failWith = null;
    expect((await b.req('GET', '/api/v1/me/push')).json().data.devices).toBe(0);
  });

  it('notification board: separate messages for employers, job seekers, one person; history is kept', async () => {
    const seeker = await signup('board-seeker@example.com');
    const emp = await employer('board-emp@example.com', 'Board Co');
    const admin = await staff('board-admin@example.com', ['admin']);
    const titles = async (b: Browser) =>
      (
        (await b.req('GET', '/api/v1/me/notifications?limit=50')).json().data as Array<{
          params: { title?: string };
        }>
      ).map((n) => n.params.title);

    const toEmployers = await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'For employers',
      message: 'Posting tips',
      audience: 'employers',
    });
    expect(toEmployers.json().data.told).toBeGreaterThanOrEqual(1);
    const toSeekers = await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'For seekers',
      message: 'New tools',
      audience: 'seekers',
    });
    expect(toSeekers.json().data.told).toBeGreaterThanOrEqual(1);
    const toOne = await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
      title: 'Just you',
      message: 'Private note',
      audience: 'user',
      email: 'board-seeker@example.com',
    });
    expect(toOne.json().data.told).toBe(1);
    expect(
      (
        await admin.req('POST', '/api/v1/admin/notifications/broadcast', {
          title: 'No target',
          message: 'Missing email',
          audience: 'user',
        })
      ).statusCode,
    ).toBe(422);

    const s = await titles(seeker);
    const e = await titles(emp);
    expect(s).toContain('For seekers');
    expect(s).toContain('Just you');
    expect(s).not.toContain('For employers');
    expect(e).toContain('For employers');
    expect(e).not.toContain('For seekers');
    expect(e).not.toContain('Just you');

    const history = (await admin.req('GET', '/api/v1/admin/notifications/history')).json()
      .data as Array<{
      title: string;
      audience: string;
      told: number;
    }>;
    expect(history.map((h) => h.title)).toEqual(
      expect.arrayContaining(['For employers', 'For seekers', 'Just you']),
    );
    expect(history.find((h) => h.title === 'For employers')).toMatchObject({
      audience: 'employers',
    });
    // non-staff cannot read or send
    expect((await emp.req('GET', '/api/v1/admin/notifications/history')).statusCode).toBe(403);
  });

  it('push text is written in the person’s language', async () => {
    const { pushText } = await import('../src/modules/push/service');
    const bn = pushText(
      'application_update',
      { tracking_code: 'C2A-AAAA-BBBB', status: 'shortlisted' },
      { type: 'application', id: '5' },
      'bn',
      false,
    );
    expect(bn!.title).toBe('আবেদনের আপডেট');
    expect(bn!.body).toContain('বাছাইকৃত');
    expect(bn!.url).toBe('/bn/app/applications/5');
    const en = pushText(
      'job_match',
      { title: 'Engineer' },
      { type: 'opportunity', id: '9' },
      'en',
      false,
    );
    expect(en).toMatchObject({ body: 'Engineer', url: '/en/opportunities/x-9' });
    expect(pushText('nonsense', {}, { type: null, id: null }, 'en', false)).toBeNull();
  });
});
