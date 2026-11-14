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
import { EmployerRepo } from '../src/modules/employer/repo';
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

describe('employers: sign-up, their own posts, review by staff, their applications', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    const me = new MeRepo(t.db);
    const opps = new OpportunityRepo(t.db);
    const adminRepo = new AdminRepo(t.db);
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
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const signup = async (email: string, extra: Record<string, unknown> = {}) => {
    const b = new Browser(app);
    await b.csrf();
    const res = await b.req('POST', '/api/v1/auth/register', {
      email,
      password: PASSWORD,
      display_name: 'Rina Recruiter',
      age_confirmed: true,
      locale: 'en',
      consents: { terms: true, privacy: true },
      ...extra,
    });
    return { b, res };
  };
  const employer = async (email: string, company = 'Acme Tech Ltd') => {
    const { b, res } = await signup(email, {
      account_type: 'employer',
      company_name: company,
      company_website: 'https://acme.example',
      phone: '+880 1711-000000',
    });
    expect(res.statusCode).toBe(202);
    expect((await b.login(email, PASSWORD)).statusCode).toBe(200);
    return b;
  };
  const seeker = async (email: string) => {
    const { b } = await signup(email);
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
  const post = (over: Record<string, unknown> = {}) => ({
    title: 'Junior Developer',
    category_slug: 'jobs',
    summary_en: 'Build features with our team.',
    deadline_date: '2026-12-30',
    vacancies: 2,
    apply_mode: 'site',
    ...over,
  });

  it('sign-up: a person chooses job seeker or employer; an employer must name the company; employers are not staff', async () => {
    const plain = await signup('seeker1@example.com');
    expect(plain.res.statusCode).toBe(202);
    const noName = await signup('noname@example.com', { account_type: 'employer' });
    expect(noName.res.statusCode).toBe(422);
    expect(JSON.stringify(noName.res.json())).toContain('company_name');
    const badSite = await signup('badsite@example.com', {
      account_type: 'employer',
      company_name: 'Bad Co',
      company_website: 'javascript:alert(1)',
    });
    expect(badSite.res.statusCode).toBe(422);

    const b = await employer('emp1@example.com');
    const me = (await b.req('GET', '/api/v1/me')).json().data;
    expect(me).toMatchObject({ employer: true, staff: false });
    expect(me.roles).toContain('employer');
    // not staff: no second factor, no staff area
    expect((await b.req('GET', '/api/v1/admin/opportunities')).json().error.code).toBe('FORBIDDEN');
    const profile = (await b.req('GET', '/api/v1/employer/profile')).json().data;
    expect(profile).toMatchObject({
      company_name: 'Acme Tech Ltd',
      verification_status: 'unverified',
    });

    const s = await seeker('seeker2@example.com');
    expect((await s.req('GET', '/api/v1/me')).json().data.employer).toBe(false);
    expect((await s.req('GET', '/api/v1/employer/overview')).json().error.code).toBe('FORBIDDEN');
    expect((await new Browser(app).req('GET', '/api/v1/employer/overview')).statusCode).toBe(401);
  });

  it('company profile can be edited by its owner', async () => {
    const b = await employer('emp2@example.com', 'Beta Works');
    const put = await b.req('PUT', '/api/v1/employer/profile', {
      company_name: 'Beta Works Limited',
      website: 'https://beta.example',
      phone: '+880 1800-000000',
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({
      company_name: 'Beta Works Limited',
      website: 'https://beta.example',
    });
    expect(
      (await b.req('PUT', '/api/v1/employer/profile', { website: 'ftp://x.example' })).statusCode,
    ).toBe(422);
  });

  it('posts: always under the employer’s own company, editable while a draft, sent for review, never touchable by others', async () => {
    const a = await employer('emp3@example.com', 'Gamma Group');
    const other = await employer('emp4@example.com', 'Delta Group');
    const created = await a.req(
      'POST',
      '/api/v1/employer/opportunities',
      post({ organization_id: '1' }),
    );
    expect(created.statusCode).toBe(422); // the company is never chosen by the employer
    const ok = await a.req('POST', '/api/v1/employer/opportunities', post());
    expect(ok.statusCode).toBe(201);
    const id = ok.json().data.id as string;
    const mine = (await a.req('GET', `/api/v1/employer/opportunities/${id}`)).json().data;
    expect(mine).toMatchObject({ publication_status: 'draft', apply_mode: 'site' });
    expect(mine.organization).toBe('Gamma Group');

    // another employer cannot see, edit, submit or close it
    expect((await other.req('GET', `/api/v1/employer/opportunities/${id}`)).statusCode).toBe(404);
    expect(
      (
        await other.req('PATCH', `/api/v1/employer/opportunities/${id}`, {
          title: 'Hijack',
          updated_at: mine.updated_at,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await other.req('POST', `/api/v1/employer/opportunities/${id}/submit`)).statusCode,
    ).toBe(404);
    expect((await other.req('GET', '/api/v1/employer/opportunities')).json().data).toHaveLength(0);

    const patched = await a.req('PATCH', `/api/v1/employer/opportunities/${id}`, {
      title: 'Junior Developer (Remote)',
      updated_at: mine.updated_at,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.title).toBe('Junior Developer (Remote)');

    // a draft without a deadline cannot be submitted
    const bare = (
      await a.req('POST', '/api/v1/employer/opportunities', {
        title: 'Bare post',
        category_slug: 'jobs',
      })
    ).json().data.id;
    const refused = await a.req('POST', `/api/v1/employer/opportunities/${bare}/submit`);
    expect(refused.statusCode).toBe(422);

    const sub = await a.req('POST', `/api/v1/employer/opportunities/${id}/submit`);
    expect(sub.statusCode).toBe(200);
    expect(sub.json().data.publication_status).toBe('in_review');
    expect(
      (await a.req('POST', `/api/v1/employer/opportunities/${id}/submit`)).json().error.code,
    ).toBe('CONFLICT');
    // not public until staff approve
    expect(
      (await new Browser(app).req('GET', `/api/v1/opportunities/${id}?locale=en`)).statusCode,
    ).toBe(404);
  });

  it('staff approve an employer post (no official circular link needed) and it goes live; the employer can close it', async () => {
    const a = await employer('emp5@example.com', 'Epsilon Labs');
    const id = (
      await a.req('POST', '/api/v1/employer/opportunities', post({ title: 'Data Analyst' }))
    ).json().data.id as string;
    await a.req('POST', `/api/v1/employer/opportunities/${id}/submit`);

    const editor = await staff('ed@example.com', ['editor']);
    expect(
      (await editor.req('POST', `/api/v1/admin/opportunities/${id}/publish`, {})).json().error.code,
    ).toBe('FORBIDDEN');
    const verifier = await staff('ver@example.com', ['verifier']);
    const list = (await verifier.req('GET', '/api/v1/admin/opportunities?status=in_review')).json()
      .data as Array<{ id: string; by_employer: boolean }>;
    expect(list.find((o) => o.id === id)).toMatchObject({ by_employer: true });
    const pub = await verifier.req('POST', `/api/v1/admin/opportunities/${id}/publish`, {});
    expect(pub.statusCode).toBe(200);
    const live = await new Browser(app).req('GET', `/api/v1/opportunities/${id}?locale=en`);
    expect(live.statusCode).toBe(200);
    expect(live.json().data.organization).toBe('Epsilon Labs');

    // editing a live post is refused until it is closed
    const cur = (await a.req('GET', `/api/v1/employer/opportunities/${id}`)).json().data;
    expect(
      (
        await a.req('PATCH', `/api/v1/employer/opportunities/${id}`, {
          title: 'Quiet change',
          updated_at: cur.updated_at,
        })
      ).json().error.code,
    ).toBe('CONFLICT');
    const closed = await a.req('POST', `/api/v1/employer/opportunities/${id}/close`);
    expect(closed.json().data.publication_status).toBe('unpublished');
    expect(
      (await new Browser(app).req('GET', `/api/v1/opportunities/${id}?locale=en`)).statusCode,
    ).toBe(404);

    const audit = await t.db.query<Row & { action: string }>(
      "SELECT action FROM audit_logs WHERE actor_role = 'employer'",
    );
    expect(audit.map((r) => r.action)).toEqual(
      expect.arrayContaining(['opportunity.create', 'opportunity.submit', 'opportunity.close']),
    );
  });

  it('applications to an employer’s post: they are told, they handle only their own, others cannot see them', async () => {
    const a = await employer('emp6@example.com', 'Zeta Systems');
    const rival = await employer('emp7@example.com', 'Eta Systems');
    const id = (
      await a.req('POST', '/api/v1/employer/opportunities', post({ title: 'QA Engineer' }))
    ).json().data.id as string;
    await a.req('POST', `/api/v1/employer/opportunities/${id}/submit`);
    const verifier = await staff('ver2@example.com', ['verifier']);
    await verifier.req('POST', `/api/v1/admin/opportunities/${id}/publish`, {});

    const applicant = await seeker('applicant-e@example.com');
    const applied = await applicant.req('POST', `/api/v1/opportunities/${id}/apply`, {
      consent: true,
      cover_note: 'Hello',
    });
    expect(applied.statusCode).toBe(201);

    // the employer is told in the app
    const notes = (await a.req('GET', '/api/v1/me/notifications')).json().data as Array<{
      type: string;
      params: { title?: string };
    }>;
    expect(notes.find((n) => n.type === 'new_application')?.params.title).toBe('QA Engineer');

    const list = (await a.req('GET', '/api/v1/employer/applications')).json();
    expect(list.data).toHaveLength(1);
    expect(list.meta.counts.submitted).toBe(1);
    const appId = list.data[0].id as string;
    expect(
      (await a.req('GET', `/api/v1/employer/applications/${appId}`)).json().data.cover_note,
    ).toBe('Hello');

    // another employer sees nothing and can change nothing
    expect((await rival.req('GET', '/api/v1/employer/applications')).json().data).toHaveLength(0);
    expect((await rival.req('GET', `/api/v1/employer/applications/${appId}`)).statusCode).toBe(404);
    expect(
      (
        await rival.req('POST', `/api/v1/employer/applications/${appId}/status`, {
          status: 'under_review',
        })
      ).statusCode,
    ).toBe(404);

    // the owner moves it forward, with a public note; rules still apply
    expect(
      (
        await a.req('POST', `/api/v1/employer/applications/${appId}/status`, { status: 'accepted' })
      ).json().error.code,
    ).toBe('CONFLICT');
    clock.advanceMs(60_000);
    const moved = await a.req('POST', `/api/v1/employer/applications/${appId}/status`, {
      status: 'under_review',
      note: 'We are reading it.',
    });
    expect(moved.statusCode).toBe(200);
    expect(
      (await a.req('PUT', `/api/v1/employer/applications/${appId}/note`, { note: 'Call Monday' }))
        .statusCode,
    ).toBe(200);
    const tracked = JSON.stringify(
      (
        await new Browser(app).req('GET', `/api/v1/track/${applied.json().data.tracking_code}`)
      ).json(),
    );
    expect(tracked).toContain('under_review');
    expect(tracked).not.toContain('Call Monday');
    // and the applicant is notified
    const mine = (await applicant.req('GET', '/api/v1/me/notifications')).json().data as Array<{
      type: string;
    }>;
    expect(mine.some((n) => n.type === 'application_update')).toBe(true);

    // overview carries the numbers
    const ov = (await a.req('GET', '/api/v1/employer/overview')).json().data;
    expect(ov.posts.published).toBe(1);
    expect(ov.applications.under_review).toBe(1);
  });

  it('staff lists never mix an employer into staff powers: an employer cannot use staff routes at all', async () => {
    const a = await employer('emp8@example.com', 'Theta Corp');
    for (const url of [
      '/api/v1/admin/overview',
      '/api/v1/admin/applications',
      '/api/v1/admin/opportunities',
    ]) {
      expect((await a.req('GET', url)).statusCode).toBe(403);
    }
  });

  it('posting is rate limited per day', async () => {
    const a = await employer('emp9@example.com', 'Iota Inc');
    let last = 201;
    for (let i = 0; i < 16; i++) {
      clock.advanceMs(1000);
      const res = await a.req(
        'POST',
        '/api/v1/employer/opportunities',
        post({ title: `Post ${i}` }),
      );
      last = res.statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
