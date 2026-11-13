import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { seedDemo, seedReference } from '../src/db/demo-seed';
import type { Row } from '../src/db/pool';
import { AdminRepo } from '../src/modules/admin/repo';
import { hashPassword } from '../src/modules/auth/crypto';
import { AuthRepo } from '../src/modules/auth/repo';
import { totpAt } from '../src/modules/auth/totp';
import { CaptureMailer } from '../src/modules/email/mailer';
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

describe('signup, profile, saved, tracker, staff MFA and posting on TiDB', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));
  const mailer = new CaptureMailer();

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer },
      opportunities: { repo: new OpportunityRepo(t.db) },
      me: { repo: new MeRepo(t.db) },
      admin: { repo: new AdminRepo(t.db) },
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const signup = (email: string, password = 'Long-Enough-Pass1!') => {
    const b = new Browser(app);
    return b.csrf().then(async () => {
      const res = await b.req('POST', '/api/v1/auth/register', {
        email,
        password,
        display_name: 'Test User',
        age_confirmed: true,
        locale: 'en',
        consents: { terms: true, privacy: true },
      });
      return { b, res, password };
    });
  };
  const signedIn = async (email: string) => {
    const { b, password } = await signup(email);
    expect((await b.login(email, password)).statusCode).toBe(200);
    return b;
  };
  const firstOppId = async (slug: string) => {
    const [r] = await t.db.query<Row & { id: string }>(
      'SELECT id FROM opportunities WHERE slug = :s',
      { s: slug },
    );
    return String(r!.id);
  };

  // ---------- signup without an email provider ----------
  it('signup works without email verification when the staging flag is off, and stays anonymous-safe', async () => {
    const cfg = await app.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(cfg.json().data.email_verification_required).toBe(false);
    const { b, res } = await signup('new.user@example.com');
    expect(res.statusCode).toBe(202);
    expect(res.json().data.email_verification_required).toBe(false);
    expect((await b.login('new.user@example.com', 'Long-Enough-Pass1!')).statusCode).toBe(200);
    expect((await b.req('GET', '/api/v1/me')).json().data.email_verified).toBe(true);
    // a duplicate gets the same answer
    const dup = await signup('NEW.user@example.com');
    expect(dup.res.statusCode).toBe(202);
    expect(mailer.sent.some((m) => m.template === 'verify_email')).toBe(false);
  });

  it('production cannot turn email verification off', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        HOSTING_TIER: 'paid',
        AI_PROVIDER: 'gemini',
        DATABASE_URL: 'mysql://u:p@h:4000/d',
        DATABASE_TLS: 'true',
        INTERNAL_HMAC_SECRETS: 's'.repeat(40),
        EMAIL_VERIFICATION_REQUIRED: 'false',
      }),
    ).toThrow(/cannot be disabled in production/);
  });

  // ---------- profile ----------
  it('profile and education: validated, versioned, owned by the user, drives completeness', async () => {
    const b = await signedIn('profile@example.com');
    expect((await b.req('GET', '/api/v1/me/profile')).json().data.completeness).toBe(0);
    const put = await b.req('PUT', '/api/v1/me/profile', {
      date_of_birth: '1999-05-10',
      gender: 'female',
      headline: 'Student',
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.profile).toMatchObject({
      date_of_birth: '1999-05-10',
      gender: 'female',
      nationality_country: 'BD',
    });
    const v1 = put.json().data.profile.profile_version;
    expect(
      (await b.req('PUT', '/api/v1/me/profile', { date_of_birth: '2999-01-01' })).statusCode,
    ).toBe(422);
    expect((await b.req('PUT', '/api/v1/me/profile', { admin: true })).statusCode).toBe(422);
    const edu = await b.req('POST', '/api/v1/me/education', {
      level: 'bachelor',
      result_scale: 'gpa4',
      result_value: 3.4,
      status: 'completed',
      passing_year: 2022,
    });
    expect(edu.statusCode).toBe(201);
    expect(
      (
        await b.req('POST', '/api/v1/me/education', {
          level: 'bachelor',
          result_scale: 'gpa4',
          result_value: 4.5,
        })
      ).statusCode,
    ).toBe(422);
    const prof = (await b.req('GET', '/api/v1/me/profile')).json().data;
    expect(prof.education).toHaveLength(1);
    expect(prof.profile.profile_version).toBeGreaterThan(v1);
    expect(prof.completeness).toBe(75);
    // another user cannot touch it
    const other = await signedIn('other@example.com');
    expect(
      (await other.req('DELETE', `/api/v1/me/education/${edu.json().data.id}`)).statusCode,
    ).toBe(404);
    expect((await other.req('GET', '/api/v1/me/profile')).json().data.education).toHaveLength(0);
    expect((await b.req('DELETE', `/api/v1/me/education/${edu.json().data.id}`)).statusCode).toBe(
      204,
    );
  });

  it('eligibility from the saved profile: eligible, then not eligible after the profile changes', async () => {
    const b = await signedIn('elig@example.com');
    const id = await firstOppId('demo-assistant-programmer');
    // nothing saved yet: unknown results, never a made-up pass
    const empty = (await b.req('POST', `/api/v1/opportunities/${id}/eligibility`)).json().data;
    expect(empty.status).toBe('insufficient_information');
    await b.req('PUT', '/api/v1/me/profile', { date_of_birth: '1999-05-10' });
    await b.req('POST', '/api/v1/me/education', {
      level: 'bachelor',
      result_scale: 'gpa4',
      result_value: 3.4,
      status: 'completed',
    });
    expect(
      (await b.req('POST', `/api/v1/opportunities/${id}/eligibility`)).json().data.status,
    ).toBe('eligible');
    await b.req('PUT', '/api/v1/me/profile', { date_of_birth: '1980-01-01' }); // too old for max age 30
    const old = (await b.req('POST', `/api/v1/opportunities/${id}/eligibility`)).json().data;
    expect(old.status).toBe('not_eligible');
    expect((await b.req('POST', '/api/v1/opportunities/999/eligibility')).statusCode).toBe(404);
  });

  // ---------- saved ----------
  it('saved opportunities: idempotent, listed newest first, unpublished cannot be saved', async () => {
    const b = await signedIn('saver@example.com');
    const a = await firstOppId('demo-office-assistant');
    const c = await firstOppId('demo-masters-scholarship');
    expect((await b.req('PUT', `/api/v1/me/saved/${a}`)).statusCode).toBe(204);
    expect((await b.req('PUT', `/api/v1/me/saved/${a}`)).statusCode).toBe(204);
    clock.advanceMs(1000);
    await b.req('PUT', `/api/v1/me/saved/${c}`);
    const list = (await b.req('GET', '/api/v1/me/saved?locale=en')).json().data;
    expect(list.map((o: { slug: string }) => o.slug)).toEqual([
      'demo-masters-scholarship',
      'demo-office-assistant',
    ]);
    expect((await b.req('PUT', '/api/v1/me/saved/999')).statusCode).toBe(404);
    expect((await b.req('DELETE', `/api/v1/me/saved/${c}`)).statusCode).toBe(204);
    expect((await b.req('GET', '/api/v1/me/saved-ids')).json().data).toEqual([a]);
    const anon = new Browser(app);
    expect((await anon.req('GET', '/api/v1/me/saved')).statusCode).toBe(401);
  });

  // ---------- tracker ----------
  it('tracker: create from an opportunity (snapshot), manual entry, status history, checklist, ownership', async () => {
    const b = await signedIn('tracker@example.com');
    const id = await firstOppId('demo-software-internship');
    const created = await b.req('POST', '/api/v1/me/applications', { opportunity_id: id });
    expect(created.statusCode).toBe(201);
    const appId = created.json().data.id;
    expect(
      (await b.req('POST', '/api/v1/me/applications', { opportunity_id: id })).statusCode,
    ).toBe(409);
    const manual = await b.req('POST', '/api/v1/me/applications', {
      title: 'Bank trainee',
      organization: 'Some Bank',
      url: 'https://example.com/apply',
      deadline_at: '2026-12-31T17:59:59Z',
    });
    expect(manual.statusCode).toBe(201);
    expect((await b.req('POST', '/api/v1/me/applications', { title: '' })).statusCode).toBe(422);
    expect(
      (await b.req('POST', '/api/v1/me/applications', { title: 'x', url: 'javascript:alert(1)' }))
        .statusCode,
    ).toBe(422);

    const list = (await b.req('GET', '/api/v1/me/applications')).json().data;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ title: '[নমুনা] সফটওয়্যার ইন্টার্নশিপ', status: 'interested' });

    const st = await b.req('POST', `/api/v1/me/applications/${appId}/status`, {
      to_status: 'applied',
      note: 'Submitted online',
    });
    expect(st.statusCode).toBe(200);
    expect(st.json().data.history.map((h: { to_status: string }) => h.to_status)).toEqual([
      'interested',
      'applied',
    ]);
    expect(
      (await b.req('POST', `/api/v1/me/applications/${appId}/status`, { to_status: 'flying' }))
        .statusCode,
    ).toBe(422);

    const patch = await b.req('PATCH', `/api/v1/me/applications/${appId}`, {
      applied_at: '2026-11-14',
      payment_status: 'paid',
      amount_paid: 200,
      notes: 'Admit card by 20 Nov',
    });
    expect(patch.json().data).toMatchObject({
      applied_at: '2026-11-14',
      payment_status: 'paid',
      amount_paid: 200,
      notes: 'Admit card by 20 Nov',
    });

    const item = (
      await b.req('POST', `/api/v1/me/applications/${appId}/checklist`, { label: 'Passport photo' })
    ).json().data.id;
    expect(
      (await b.req('PATCH', `/api/v1/me/applications/${appId}/checklist/${item}`, { done: true }))
        .statusCode,
    ).toBe(200);
    const detail = (await b.req('GET', `/api/v1/me/applications/${appId}`)).json().data;
    expect(detail.checklist).toEqual([
      { id: item, label: 'Passport photo', done: true, origin: 'user' },
    ]);
    expect((await b.req('GET', '/api/v1/me/applications/stats')).json().data).toMatchObject({
      applied: 1,
      interested: 1,
    });

    // another user: no access to anything
    const other = await signedIn('tracker2@example.com');
    expect((await other.req('GET', `/api/v1/me/applications/${appId}`)).statusCode).toBe(404);
    expect(
      (await other.req('PATCH', `/api/v1/me/applications/${appId}`, { notes: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (await other.req('POST', `/api/v1/me/applications/${appId}/checklist`, { label: 'x' }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await other.req('PATCH', `/api/v1/me/applications/${appId}/checklist/${item}`, {
          done: false,
        })
      ).statusCode,
    ).toBe(404);
    expect((await other.req('DELETE', `/api/v1/me/applications/${appId}`)).statusCode).toBe(404);
    expect((await other.req('GET', '/api/v1/me/applications')).json().data).toEqual([]);

    // the snapshot survives removal of the opportunity
    await t.db.execute("UPDATE opportunities SET publication_status = 'removed' WHERE id = :id", {
      id,
    });
    expect((await b.req('GET', `/api/v1/me/applications/${appId}`)).json().data.title).toBe(
      '[নমুনা] সফটওয়্যার ইন্টার্নশিপ',
    );
    await t.db.execute("UPDATE opportunities SET publication_status = 'published' WHERE id = :id", {
      id,
    });
    expect((await b.req('DELETE', `/api/v1/me/applications/${appId}`)).statusCode).toBe(204);
  });

  // ---------- categories, locations, filters ----------
  it('categories with counts, locations, and list filters (location, sort)', async () => {
    const cats = (await app.inject({ method: 'GET', url: '/api/v1/categories?locale=en' })).json()
      .data;
    expect(cats.map((c: { slug: string; count: number }) => [c.slug, c.count])).toEqual([
      ['jobs', 3],
      ['internships', 1],
      ['scholarships', 2],
    ]);
    const locs = (await app.inject({ method: 'GET', url: '/api/v1/locations?locale=bn' })).json()
      .data;
    expect(
      locs.some((l: { slug: string; name: string }) => l.slug === 'dhaka' && l.name === 'ঢাকা'),
    ).toBe(true);
    const dhaka = (
      await app.inject({ method: 'GET', url: '/api/v1/opportunities?location=dhaka' })
    ).json();
    expect(dhaka.meta.total).toBe(2);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/opportunities?sort=newest&limit=1' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/opportunities?location=../etc' }))
        .statusCode,
    ).toBe(422);
  });

  // ---------- staff MFA ----------
  const makeStaff = async (email: string, roles: string[]) => {
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
    for (const r of roles)
      await t.db.execute('INSERT INTO user_roles (user_id, role) VALUES (:id, :r)', {
        id: created!.id,
        r,
      });
    return created!.id;
  };
  const enrolStaff = async (email: string) => {
    const b = new Browser(app);
    const login = await b.login(email, 'staff password 123');
    expect(login.json().data).toMatchObject({ mfa_required: true });
    const en = await b.req('POST', '/api/v1/auth/mfa/enroll');
    const secret = en.json().data.secret as string;
    const conf = await b.req('POST', '/api/v1/auth/mfa/confirm', {
      code: totpAt(secret, clock.now().getTime()),
    });
    expect(conf.statusCode).toBe(200);
    return { b, secret, recovery: conf.json().data.recovery_codes as string[] };
  };

  it('staff cannot use any staff route until the second factor is verified', async () => {
    await makeStaff('editor@example.com', ['editor']);
    const b = new Browser(app);
    const login = await b.login('editor@example.com', 'staff password 123');
    expect(login.json().data).toMatchObject({ mfa_required: true, mfa_enrolled: false });
    expect((await b.req('GET', '/api/v1/admin/opportunities')).json().error.code).toBe(
      'MFA_REQUIRED',
    );
    expect((await b.req('GET', '/api/v1/me/profile')).json().error.code).toBe('MFA_REQUIRED');
    expect((await b.req('GET', '/api/v1/me')).json().data).toMatchObject({
      staff: true,
      mfa_verified: false,
    });
    // a plain user is simply forbidden from admin routes
    const user = await signedIn('plain@example.com');
    expect((await user.req('GET', '/api/v1/admin/opportunities')).json().error.code).toBe(
      'FORBIDDEN',
    );
    expect((await user.req('POST', '/api/v1/auth/mfa/enroll')).statusCode).toBe(403);
  });

  it('MFA enrolment: wrong code refused, ten recovery codes once, TOTP and recovery login, replay of a recovery code refused', async () => {
    await makeStaff('mfa@example.com', ['editor']);
    const b = new Browser(app);
    await b.login('mfa@example.com', 'staff password 123');
    const en = (await b.req('POST', '/api/v1/auth/mfa/enroll')).json().data;
    expect(en.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    expect((await b.req('POST', '/api/v1/auth/mfa/confirm', { code: '000000' })).statusCode).toBe(
      401,
    );
    const conf = await b.req('POST', '/api/v1/auth/mfa/confirm', {
      code: totpAt(en.secret, clock.now().getTime()),
    });
    const codes = conf.json().data.recovery_codes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect((await b.req('GET', '/api/v1/admin/overview')).statusCode).toBe(200);
    // enrolment cannot be repeated or replaced
    expect((await b.req('POST', '/api/v1/auth/mfa/enroll')).statusCode).toBe(409);
    const stored = await t.db.query<Row & { n: number }>(
      'SELECT COUNT(*) n FROM mfa_recovery_codes',
    );
    expect(Number(stored[0]!.n)).toBeGreaterThanOrEqual(10);
    const raw = await t.db.query<Row & { totp_secret_enc: Buffer }>(
      "SELECT totp_secret_enc FROM users WHERE email_normalized = 'mfa@example.com'",
    );
    expect(raw[0]!.totp_secret_enc.toString('utf8')).not.toContain(en.secret); // encrypted at rest

    // new session: password alone is not enough, TOTP is
    const b2 = new Browser(app);
    expect((await b2.login('mfa@example.com', 'staff password 123')).json().data.mfa_enrolled).toBe(
      true,
    );
    expect((await b2.req('GET', '/api/v1/admin/overview')).json().error.code).toBe('MFA_REQUIRED');
    expect((await b2.req('POST', '/api/v1/auth/mfa/verify', { code: '123456' })).statusCode).toBe(
      401,
    );
    clock.advanceMs(31_000);
    expect(
      (
        await b2.req('POST', '/api/v1/auth/mfa/verify', {
          code: totpAt(en.secret, clock.now().getTime()),
        })
      ).statusCode,
    ).toBe(200);
    expect((await b2.req('GET', '/api/v1/admin/overview')).statusCode).toBe(200);

    // recovery code works once
    const b3 = new Browser(app);
    await b3.login('mfa@example.com', 'staff password 123');
    expect(
      (await b3.req('POST', '/api/v1/auth/mfa/verify', { recovery_code: codes[0] })).json().data
        .recovery_codes_left,
    ).toBe(9);
    const b4 = new Browser(app);
    await b4.login('mfa@example.com', 'staff password 123');
    expect(
      (await b4.req('POST', '/api/v1/auth/mfa/verify', { recovery_code: codes[0] })).statusCode,
    ).toBe(401);
  });

  it('staff sessions are short: 30 minutes idle', async () => {
    await makeStaff('short@example.com', ['editor']);
    const { b } = await enrolStaff('short@example.com');
    expect((await b.req('GET', '/api/v1/admin/overview')).statusCode).toBe(200);
    clock.advanceMs(31 * 60_000);
    expect((await b.req('GET', '/api/v1/admin/overview')).statusCode).toBe(401);
  });

  // ---------- posting and publishing ----------
  it('an editor drafts an opportunity, cannot publish; a verifier publishes, it goes public, unpublish hides it; audited', async () => {
    await makeStaff('ed2@example.com', ['editor']);
    await makeStaff('ver2@example.com', ['verifier', 'editor']);
    const ed = (await enrolStaff('ed2@example.com')).b;
    const ver = (await enrolStaff('ver2@example.com')).b;

    const org = await ed.req('POST', '/api/v1/admin/organizations', {
      name_en: 'Test Power Board',
      name_bn: 'টেস্ট বিদ্যুৎ বোর্ড',
      type: 'government',
    });
    expect(org.statusCode).toBe(201);
    expect(
      (
        await ed.req('POST', '/api/v1/admin/organizations', {
          name_en: 'Test Power Board',
          type: 'government',
        })
      ).statusCode,
    ).toBe(409);
    const orgId = org.json().data.id;

    const created = await ed.req('POST', '/api/v1/admin/opportunities', {
      title: 'সহকারী প্রকৌশলী (বিদ্যুৎ)',
      title_alt: 'Assistant Engineer (Electrical)',
      organization_id: orgId,
      category_slug: 'jobs',
      position_title: 'Assistant Engineer',
      summary_en: 'Recruitment for Assistant Engineer.',
      summary_bn: 'সহকারী প্রকৌশলী পদে নিয়োগ।',
      vacancies: 20,
      deadline_date: '2026-12-31',
      location_slug: 'dhaka',
      official_url: 'https://example.gov.bd/circular/123',
      requirements: [
        {
          rule_type: 'age',
          necessity: 'mandatory',
          params: { max: 30, as_of: '2026-12-31' },
          text: 'Age at most 30',
        },
        {
          rule_type: 'education_level',
          necessity: 'mandatory',
          params: { min_level: 'bachelor' },
          text: 'Bachelor in Engineering',
        },
      ],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    // draft is invisible to the public
    const pub = async (path: string) => app.inject({ method: 'GET', url: path });
    expect((await pub(`/api/v1/opportunities/${id}`)).statusCode).toBe(404);
    expect((await pub('/api/v1/search?q=engineer')).json().meta.total).toBe(0);

    // an editor cannot publish
    expect(
      (await ed.req('POST', `/api/v1/admin/opportunities/${id}/publish`, {})).json().error.code,
    ).toBe('FORBIDDEN');

    // verifier publishes
    const published = await ver.req('POST', `/api/v1/admin/opportunities/${id}/publish`, {
      reason: 'Matches the official circular',
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().data).toMatchObject({
      publication_status: 'published',
      verification_state: 'verified_official',
    });
    const detail = (await pub(`/api/v1/opportunities/${id}?locale=en`)).json().data;
    expect(detail).toMatchObject({
      title: 'সহকারী প্রকৌশলী (বিদ্যুৎ)',
      verified: true,
      vacancies: 20,
      location: 'Dhaka',
      organization: 'Test Power Board',
    });
    expect(detail.requirements.every((r: { verified: boolean }) => r.verified)).toBe(true);
    expect((await pub('/api/v1/search?q=engineer')).json().meta.total).toBe(1);
    expect(
      (
        await pub(
          '/api/v1/search?q=%E0%A6%AA%E0%A7%8D%E0%A6%B0%E0%A6%95%E0%A7%8C%E0%A6%B6%E0%A6%B2%E0%A7%80',
        )
      ).json().meta.total,
    ).toBe(1);
    expect((await pub('/api/v1/opportunities')).json().meta.total).toBe(7);

    // editing with a stale updated_at is refused; with the current one it works
    const before = (await ed.req('GET', `/api/v1/admin/opportunities/${id}`)).json().data;
    const stale = await ed.req('PATCH', `/api/v1/admin/opportunities/${id}`, {
      vacancies: 25,
      updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.json().error.code).toBe('EDIT_CONFLICT');
    const ok = await ed.req('PATCH', `/api/v1/admin/opportunities/${id}`, {
      vacancies: 25,
      updated_at: before.updated_at,
    });
    expect(ok.json().data.vacancies).toBe(25);

    // unpublish hides it again
    expect(
      (
        await ver.req('POST', `/api/v1/admin/opportunities/${id}/unpublish`, {
          reason: 'Corrigendum pending',
        })
      ).statusCode,
    ).toBe(200);
    expect((await pub(`/api/v1/opportunities/${id}`)).statusCode).toBe(404);
    expect((await pub('/api/v1/search?q=engineer')).json().meta.total).toBe(0);
    // remove needs the stronger permission
    expect(
      (await ver.req('POST', `/api/v1/admin/opportunities/${id}/remove`, {})).json().error.code,
    ).toBe('FORBIDDEN');

    // publishing without an official link is refused
    const noLink = (
      await ed.req('POST', '/api/v1/admin/opportunities', {
        title: 'No link job',
        organization_id: orgId,
        category_slug: 'jobs',
      })
    ).json().data.id;
    expect(
      (await ver.req('POST', `/api/v1/admin/opportunities/${noLink}/publish`, {})).statusCode,
    ).toBe(422);

    // validation
    expect(
      (
        await ed.req('POST', '/api/v1/admin/opportunities', {
          title: 'x',
          organization_id: orgId,
          category_slug: 'jobs',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await ed.req('POST', '/api/v1/admin/opportunities', {
          title: 'Valid title',
          organization_id: orgId,
          category_slug: 'nope',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await ed.req('POST', '/api/v1/admin/opportunities', {
          title: 'Valid title',
          organization_id: orgId,
          category_slug: 'jobs',
          official_url: 'javascript:alert(1)',
        })
      ).statusCode,
    ).toBe(422);

    // list and audit trail
    const list = (await ed.req('GET', '/api/v1/admin/opportunities?status=draft')).json();
    expect(list.data.some((o: { id: string }) => o.id === noLink)).toBe(true);
    const sup = await makeStaff('super2@example.com', ['super_admin']);
    const su = (await enrolStaff('super2@example.com')).b;
    const audit = (await su.req('GET', '/api/v1/admin/audit-logs')).json().data as Array<{
      action: string;
    }>;
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'opportunity.create',
        'opportunity.publish',
        'opportunity.unpublish',
        'opportunity.update',
        'organization.create',
      ]),
    );
    expect((await ed.req('GET', '/api/v1/admin/audit-logs')).json().error.code).toBe('FORBIDDEN');
    void sup;
  });

  it('roles: only a super admin changes them, it revokes sessions, and nobody removes their own super admin', async () => {
    const targetId = await makeStaff('promote@example.com', []);
    const su = (
      await enrolStaff(
        await (async () => {
          await makeStaff('super3@example.com', ['super_admin']);
          return 'super3@example.com';
        })(),
      )
    ).b;
    const users = (await su.req('GET', '/api/v1/admin/users?q=promote')).json().data;
    expect(users[0]).toMatchObject({ email: 'promote@example.com', roles: ['user'] });
    const victim = await signedIn('victim@example.com');
    expect(
      (
        await victim.req('PUT', `/api/v1/admin/users/${targetId}/roles`, { roles: ['admin'] })
      ).json().error.code,
    ).toBe('FORBIDDEN');
    const res = await su.req('PUT', `/api/v1/admin/users/${targetId}/roles`, { roles: ['editor'] });
    expect(res.statusCode).toBe(204);
    expect(
      (await su.req('GET', '/api/v1/admin/users?q=promote')).json().data[0].roles.sort(),
    ).toEqual(['editor', 'user']);
    expect(
      (
        await su.req(
          'PUT',
          `/api/v1/admin/users/${(await su.req('GET', '/api/v1/me')).json().data.id}/roles`,
          { roles: ['editor'] },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await su.req('PUT', `/api/v1/admin/users/${targetId}/roles`, { roles: ['wizard'] }))
        .statusCode,
    ).toBe(422);
  });
});
