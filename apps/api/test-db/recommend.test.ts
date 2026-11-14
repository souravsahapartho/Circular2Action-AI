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

describe('recommendations, activity and notifications on TiDB', () => {
  let t: TestDb;
  let app: FastifyInstance;
  let service: RecommendService;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    const me = new MeRepo(t.db);
    const opps = new OpportunityRepo(t.db);
    service = new RecommendService(t.db, me, opps, clock);
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer: new CaptureMailer() },
      opportunities: { repo: opps },
      me: { repo: me },
      admin: { repo: new AdminRepo(t.db) },
      applications: { repo: new ApplicationRepo(t.db) },
      recommend: { service },
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
  const userIdOf = async (email: string) => {
    const [r] = await t.db.query<Row & { id: string }>(
      'SELECT id FROM users WHERE email_normalized = :e',
      { e: email },
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
    return b;
  };
  const prefs = (over: Record<string, unknown> = {}) => ({
    categories: [],
    keywords: [],
    location_slugs: [],
    alerts_enabled: true,
    personalize: true,
    ...over,
  });
  const titles = (res: { json: () => { data: { opportunities: Array<{ title: string }> } } }) =>
    res.json().data.opportunities.map((o) => o.title);

  it('preferences: defaults, validation, saved and read back', async () => {
    const b = await user('prefs@example.com');
    const def = (await b.req('GET', '/api/v1/me/preferences')).json().data;
    expect(def).toMatchObject({
      alerts_enabled: true,
      personalize: true,
      categories: [],
      activity_count: 0,
    });
    expect(
      (await b.req('PUT', '/api/v1/me/preferences', { ...prefs(), categories: ['Not A Slug!'] }))
        .statusCode,
    ).toBe(422);
    expect((await b.req('PUT', '/api/v1/me/preferences', { categories: [] })).statusCode).toBe(422);
    const put = await b.req(
      'PUT',
      '/api/v1/me/preferences',
      prefs({
        categories: ['scholarships', 'jobs'],
        keywords: ['Programmer ', 'programmer'],
        location_slugs: ['dhaka'],
      }),
    );
    expect(put.statusCode).toBe(200);
    expect(put.json().data.keywords).toEqual(['programmer']); // trimmed, lower-cased, de-duplicated
    expect((await b.req('GET', '/api/v1/me/preferences')).json().data.categories).toEqual([
      'scholarships',
      'jobs',
    ]);
    // anonymous is refused
    const anon = new Browser(app);
    expect((await anon.req('GET', '/api/v1/me/preferences')).statusCode).toBe(401);
    expect((await anon.req('GET', '/api/v1/me/recommendations')).statusCode).toBe(401);
  });

  it('activity: views are recorded once per ten minutes, switching personalisation off stops it, clearing deletes it', async () => {
    const b = await user('activity@example.com');
    const uid = await userIdOf('activity@example.com');
    const prog = await idOf('demo-assistant-programmer');
    const view = () =>
      b.req('POST', '/api/v1/me/interactions', { kind: 'view', opportunity_id: prog });
    expect((await view()).statusCode).toBe(204);
    expect((await view()).statusCode).toBe(204); // the same view again is not counted
    expect(await service.activityCount(uid)).toBe(1);
    clock.advanceMs(11 * 60 * 1000);
    await view();
    expect(await service.activityCount(uid)).toBe(2);

    expect((await b.req('POST', '/api/v1/me/interactions', { kind: 'view' })).statusCode).toBe(422);
    expect(
      (await b.req('POST', '/api/v1/me/interactions', { kind: 'bogus', term: 'x' })).statusCode,
    ).toBe(422);
    expect(
      (await b.req('POST', '/api/v1/me/interactions', { kind: 'search', term: 'software' }))
        .statusCode,
    ).toBe(204);
    expect(await service.activityCount(uid)).toBe(3);

    await b.req('PUT', '/api/v1/me/preferences', prefs({ personalize: false }));
    clock.advanceMs(11 * 60 * 1000);
    await view();
    expect(await service.activityCount(uid)).toBe(3); // nothing recorded while it is off

    const cleared = await b.req('DELETE', '/api/v1/me/activity');
    expect(cleared.json().data.deleted).toBe(3);
    expect(await service.activityCount(uid)).toBe(0);
  });

  it('saving and tracking are recorded automatically and shape the suggestions', async () => {
    const scholar = await user('scholar@example.com');
    const jobber = await user('jobber@example.com');
    await scholar.req('PUT', `/api/v1/me/saved/${await idOf('demo-masters-scholarship')}`);
    await jobber.req('PUT', `/api/v1/me/saved/${await idOf('demo-office-assistant')}`);
    await jobber.req('POST', '/api/v1/me/applications', {
      opportunity_id: await idOf('demo-data-entry-operator'),
    });

    const [ev] = await t.db.query<Row & { n: number }>(
      "SELECT COUNT(*) n FROM interaction_events WHERE kind IN ('save', 'track')",
    );
    expect(Number(ev!.n)).toBe(3);

    const forScholar = await scholar.req('GET', '/api/v1/me/recommendations?locale=en&limit=6');
    const forJobber = await jobber.req('GET', '/api/v1/me/recommendations?locale=en&limit=6');
    expect(forScholar.statusCode).toBe(200);
    // saved and tracked items are not suggested again
    expect(titles(forScholar)).not.toContain('[Sample] Masters Scholarship');
    expect(titles(forJobber)).not.toContain('[Sample] Office Assistant');
    expect(titles(forJobber)).not.toContain('[Sample] Data Entry Operator');
    const catOf = (r: typeof forScholar) =>
      r
        .json()
        .data.opportunities.slice(0, 2)
        .map((o: { category_slug: string }) => o.category_slug);
    // a person who saved scholarships sees scholarships first; a person who saved jobs does not
    expect(catOf(forScholar)).toContain('scholarships');
    expect(forScholar.json().data.opportunities[0].reasons.length).toBeGreaterThan(0);
    expect(forScholar.json().data.personalised).toBe(true);
    expect(titles(forScholar)[0]).not.toBe(titles(forJobber)[0]);
  });

  it('explicit interests: keywords and categories bring matching items up, with reasons', async () => {
    const b = await user('keywords@example.com');
    await b.req(
      'PUT',
      '/api/v1/me/preferences',
      prefs({ keywords: ['internship'], categories: ['internships'] }),
    );
    const res = await b.req('GET', '/api/v1/me/recommendations?locale=en&limit=3');
    const top = res.json().data.opportunities[0];
    expect(top.title).toBe('[Sample] Software Internship');
    expect(top.reasons.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['category_interest', 'keyword']),
    );
  });

  it('a brand new person still gets a sensible list (closing soon, nothing hidden)', async () => {
    const b = await user('newbie@example.com');
    const res = await b.req('GET', '/api/v1/me/recommendations?locale=en&limit=6');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.opportunities.length).toBeGreaterThan(0);
    expect(res.json().data.personalised).toBe(false);
  });

  it('notifications: strong matches create one notification each, deduplicated, with read state', async () => {
    const b = await user('alerts@example.com');
    const uid = await userIdOf('alerts@example.com');
    await b.req(
      'PUT',
      '/api/v1/me/preferences',
      prefs({ keywords: ['programmer'], categories: ['jobs'] }),
    );
    const first = await b.req('GET', '/api/v1/me/notifications');
    expect(first.statusCode).toBe(200);
    const items = first.json().data as Array<{
      id: string;
      type: string;
      params: { title_alt?: string };
      read: boolean;
    }>;
    expect(
      items.some((n) => n.type === 'job_match' && n.params.title_alt?.includes('Programmer')),
    ).toBe(true);
    const unread = first.json().meta.unread as number;
    expect(unread).toBeGreaterThan(0);

    // asking again (even forced) never repeats a notification
    await service.refreshNotifications(uid, true);
    await service.refreshNotifications(uid, true);
    const second = await b.req('GET', '/api/v1/me/notifications');
    expect(second.json().data).toHaveLength(items.length);

    const count = await b.req('GET', '/api/v1/me/notifications/unread-count');
    expect(count.json().data.unread).toBe(unread);
    const one = await b.req('POST', '/api/v1/me/notifications/read', { ids: [items[0]!.id] });
    expect(one.json().data.unread).toBe(unread - 1);
    const all = await b.req('POST', '/api/v1/me/notifications/read', { all: true });
    expect(all.json().data.unread).toBe(0);

    // alerts off: no new job_match notifications are created
    const quiet = await user('quiet@example.com');
    const qid = await userIdOf('quiet@example.com');
    await quiet.req(
      'PUT',
      '/api/v1/me/preferences',
      prefs({ keywords: ['programmer'], categories: ['jobs'], alerts_enabled: false }),
    );
    await service.refreshNotifications(qid, true);
    expect(
      (await quiet.req('GET', '/api/v1/me/notifications'))
        .json()
        .data.filter((n: { type: string }) => n.type === 'job_match'),
    ).toHaveLength(0);

    // one person never sees another's notifications
    expect(
      (await quiet.req('POST', '/api/v1/me/notifications/read', { all: true })).json().data.updated,
    ).toBe(0);
  });

  it('deadline reminders: a saved opportunity closing within 72 hours reminds once per slot', async () => {
    const b = await user('reminder@example.com');
    const uid = await userIdOf('reminder@example.com');
    await b.req('PUT', `/api/v1/me/saved/${await idOf('demo-masters-scholarship')}`); // closes in 40 days
    const reminders = async () =>
      (await service.notifications(uid, { limit: 50 })).items.filter(
        (n) => n.type === 'deadline_reminder',
      );
    await service.refreshNotifications(uid, true);
    expect(await reminders()).toHaveLength(0);

    clock.advanceMs(39 * 86_400_000); // about 36 hours before the deadline
    await service.refreshNotifications(uid, true);
    await service.refreshNotifications(uid, true);
    const first = await reminders();
    expect(first).toHaveLength(1);
    expect(first[0]!.params.slot).toBe('72h');

    clock.advanceMs(18 * 3_600_000); // inside the last 24 hours: one more, in a different slot
    await service.refreshNotifications(uid, true);
    await service.refreshNotifications(uid, true);
    const second = await reminders();
    expect(second).toHaveLength(2);
    expect(second.map((n) => n.params.slot).sort()).toEqual(['24h', '72h']);
    clock.advanceMs(-(39 * 86_400_000 + 18 * 3_600_000)); // restore the clock for the other tests
  });

  it('publishing fans out to matching people only, and a status change notifies the applicant', async () => {
    const fan = await user('fan@example.com');
    const bystander = await user('bystander@example.com');
    const fanId = await userIdOf('fan@example.com');
    const byId = await userIdOf('bystander@example.com');
    await fan.req(
      'PUT',
      '/api/v1/me/preferences',
      prefs({ keywords: ['cybersecurity'], categories: ['jobs'] }),
    );
    await bystander.req(
      'PUT',
      '/api/v1/me/preferences',
      prefs({ keywords: ['nursing'], categories: ['scholarships'] }),
    );
    // let both be "recently matched" so only the publish fan-out can reach them
    await service.refreshNotifications(fanId, true);
    await service.refreshNotifications(byId, true);

    const admin = await staff('fan-admin@example.com', ['admin']);
    const [org] = await t.db.query<Row & { id: string }>('SELECT id FROM organizations LIMIT 1');
    const created = await admin.req('POST', '/api/v1/admin/opportunities', {
      title: 'Cybersecurity Analyst',
      organization_id: String(org!.id),
      category_slug: 'jobs',
      official_url: 'https://example.org/circular',
      deadline_date: '2027-01-15',
      apply_mode: 'site',
    });
    expect(created.statusCode).toBe(201);
    const newId = created.json().data.id as string;
    expect(
      (await admin.req('POST', `/api/v1/admin/opportunities/${newId}/publish`, {})).statusCode,
    ).toBe(200);

    const told = async (uid: string) => {
      const [r] = await t.db.query<Row & { n: number }>(
        "SELECT COUNT(*) n FROM notifications WHERE user_id = :u AND type = 'job_match' AND subject_id = :o",
        { u: uid, o: newId },
      );
      return Number(r!.n);
    };
    for (let i = 0; i < 40 && (await told(fanId)) === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(await told(fanId)).toBe(1);
    expect(await told(byId)).toBe(0);
    // publishing again (or running the fan-out twice) does not repeat it
    await service.fanOut(newId);
    expect(await told(fanId)).toBe(1);

    // application updates reach the applicant
    const applicant = await user('applicant-n@example.com');
    const programmer = await idOf('demo-assistant-programmer');
    const applied = await applicant.req('POST', `/api/v1/opportunities/${programmer}/apply`, {
      consent: true,
    });
    expect(applied.statusCode).toBe(201);
    const [a] = await t.db.query<Row & { id: string }>('SELECT id FROM site_applications');
    clock.advanceMs(60_000);
    await admin.req('POST', `/api/v1/admin/applications/${a!.id}/status`, {
      status: 'under_review',
      note: 'Reading it now.',
    });
    clock.advanceMs(60_000);
    await admin.req('POST', `/api/v1/admin/applications/${a!.id}/status`, {
      status: 'shortlisted',
      note: 'Private remark.',
      visible_to_applicant: false,
    });
    const mine = (await applicant.req('GET', '/api/v1/me/notifications')).json().data as Array<{
      type: string;
      params: { status?: string; note?: string };
    }>;
    const updates = mine.filter((n) => n.type === 'application_update');
    expect(updates).toHaveLength(1); // the private step does not notify
    expect(updates[0]!.params).toMatchObject({ status: 'under_review', note: 'Reading it now.' });
  });

  it('personalisation data is deleted with the account', async () => {
    const b = await user('leaver@example.com');
    const uid = await userIdOf('leaver@example.com');
    await b.req('PUT', '/api/v1/me/preferences', prefs({ keywords: ['x1'] }));
    await b.req('PUT', `/api/v1/me/saved/${await idOf('demo-office-assistant')}`);
    expect(await service.activityCount(uid)).toBeGreaterThan(0);
    await t.db.execute('DELETE FROM users WHERE id = :u', { u: uid });
    const [n] = await t.db.query<Row & { n: number }>(
      'SELECT (SELECT COUNT(*) FROM interaction_events WHERE user_id = :u) + (SELECT COUNT(*) FROM job_preferences WHERE user_id = :u) AS n',
      { u: uid },
    );
    expect(Number(n!.n)).toBe(0);
  });
});
