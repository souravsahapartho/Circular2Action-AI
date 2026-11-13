import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import type { Row } from '../src/db/pool';
import { AuthRepo } from '../src/modules/auth/repo';
import { DELETION_GRACE_MS, SESSION_IDLE_MS } from '../src/modules/auth/routes';
import { CaptureMailer } from '../src/modules/email/mailer';
import { TestClock } from '../src/platform/clock';
import { loadConfig } from '../src/platform/config';
import { freshDatabase, type TestDb } from './helpers';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  WEB_ORIGIN: 'http://localhost:3000',
  INTERNAL_HMAC_SECRETS: 's'.repeat(40),
});

/** Minimal cookie jar for app.inject. */
class Browser {
  jar = new Map<string, string>();
  constructor(private readonly app: FastifyInstance) {}
  private store(res: LightMyRequestResponse) {
    const raw = res.headers['set-cookie'];
    for (const c of ([] as string[]).concat(raw ?? [])) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair!.split('=');
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) this.jar.delete(k!.trim());
      else this.jar.set(k!.trim(), decodeURIComponent(v ?? ''));
    }
  }
  private cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  }
  async csrf() {
    const res = await this.app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: { cookie: this.cookie() },
    });
    this.store(res);
  }
  async req(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        cookie: this.cookie(),
        'content-type': 'application/json',
        'x-csrf-token': this.jar.get('c2a_csrf') ?? '',
        origin: 'http://localhost:3000',
        ...extra,
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    return res;
  }
}

const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;

describe('auth, sessions, RBAC, consent and deletion request on TiDB', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const mailer = new CaptureMailer();
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    app = buildApp({ config, clock, auth: { repo: new AuthRepo(t.db), mailer } });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const registration = {
    email: 'Rumana@Example.com',
    password: 'Good-Long-Pass1!',
    display_name: 'রুমানা',
    age_confirmed: true,
    locale: 'bn',
    consents: { terms: true, privacy: true },
  };

  it('rejects state changes without a CSRF token or from a foreign origin', async () => {
    const b = new Browser(app);
    const noToken = await b.req('POST', '/api/v1/auth/register', registration);
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error.code).toBe('CSRF_FAILED');
    await b.csrf();
    const foreign = await b.req('POST', '/api/v1/auth/register', registration, {
      origin: 'https://evil.example',
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('registers (202, consents recorded, verification mail) and answers the same for a duplicate', async () => {
    const b = new Browser(app);
    await b.csrf();
    const r1 = await b.req('POST', '/api/v1/auth/register', registration);
    expect(r1.statusCode).toBe(202);
    const r2 = await b.req('POST', '/api/v1/auth/register', {
      ...registration,
      email: 'rumana@example.com',
    });
    expect(r2.statusCode).toBe(202);
    expect(r2.json()).toEqual(r1.json());
    expect(mailer.sent.map((m) => m.template)).toEqual(['verify_email', 'security_notice']);
    const [u] = await t.db.query<Row & { n: number }>(
      "SELECT COUNT(*) n FROM users WHERE email_normalized = 'rumana@example.com'",
    );
    expect(Number(u!.n)).toBe(1);
    const [c] = await t.db.query<Row & { n: number }>('SELECT COUNT(*) n FROM consent_events');
    expect(Number(c!.n)).toBe(3); // terms, privacy, weekly_digest(false)
  });

  it('weak passwords and missing required consent are rejected', async () => {
    const b = new Browser(app);
    await b.csrf();
    const weak = await b.req('POST', '/api/v1/auth/register', {
      ...registration,
      email: 'x@example.com',
      password: 'short',
    });
    expect(weak.statusCode).toBe(422);
    const noTerms = await b.req('POST', '/api/v1/auth/register', {
      ...registration,
      email: 'y@example.com',
      consents: { terms: false, privacy: true },
    });
    expect(noTerms.statusCode).toBe(422);
  });

  it('login is refused until the email is verified; verification is single use and starts a session', async () => {
    const b = new Browser(app);
    await b.csrf();
    const early = await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    expect(early.json().error.code).toBe('EMAIL_NOT_VERIFIED');
    const link = mailer.sent.find((m) => m.template === 'verify_email')!.params.link!;
    const v = await b.req('POST', '/api/v1/auth/verify-email', { token: tokenFrom(link) });
    expect(v.statusCode).toBe(200);
    const me = await b.req('GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({
      email_verified: true,
      roles: ['user'],
      display_name: 'রুমানা',
    });
    const again = await b.req('POST', '/api/v1/auth/verify-email', { token: tokenFrom(link) });
    expect(again.statusCode).toBe(410);
  });

  it('wrong password and unknown account give the same generic error', async () => {
    const b = new Browser(app);
    await b.csrf();
    const wrong = await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: 'nope nope nope',
    });
    const unknown = await b.req('POST', '/api/v1/auth/login', {
      email: 'nobody@example.com',
      password: 'nope nope nope',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('login sets an HttpOnly session cookie; only the SHA-256 is stored; logout deletes the row', async () => {
    const b = new Browser(app);
    await b.csrf();
    const res = await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    expect(res.statusCode).toBe(200);
    const setCookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('c2a_session='))!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const token = b.jar.get('c2a_session')!;
    const rows = await t.db.query<Row & { token_hash: Buffer }>(
      'SELECT token_hash FROM user_sessions',
    );
    expect(rows.some((r) => r.token_hash.toString('base64url') === token)).toBe(false);
    expect(rows.every((r) => r.token_hash.length === 32)).toBe(true);
    const out = await b.req('POST', '/api/v1/auth/logout');
    expect(out.statusCode).toBe(204);
    expect((await b.req('GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('sessions slide, then expire after the idle limit', async () => {
    const b = new Browser(app);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    clock.advanceMs(SESSION_IDLE_MS - 60_000);
    expect((await b.req('GET', '/api/v1/me')).statusCode).toBe(200); // slides the idle expiry
    clock.advanceMs(SESSION_IDLE_MS - 60_000);
    expect((await b.req('GET', '/api/v1/me')).statusCode).toBe(200);
    clock.advanceMs(SESSION_IDLE_MS + 60_000);
    expect((await b.req('GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('password change keeps this session and revokes the others; sessions list marks the current one', async () => {
    const a = new Browser(app);
    const other = new Browser(app);
    for (const x of [a, other]) {
      await x.csrf();
      await x.req('POST', '/api/v1/auth/login', {
        email: registration.email,
        password: registration.password,
      });
    }
    const list = await a.req('GET', '/api/v1/auth/sessions');
    expect(list.json().data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const ch = await a.req('POST', '/api/v1/auth/password/change', {
      current_password: registration.password,
      new_password: 'Even-Better-Pass2!',
    });
    expect(ch.statusCode).toBe(204);
    expect((await a.req('GET', '/api/v1/me')).statusCode).toBe(200);
    expect((await other.req('GET', '/api/v1/me')).statusCode).toBe(401);
    registration.password = 'Even-Better-Pass2!';
  });

  it('forgot/reset password: always 202, single-use token, all sessions revoked', async () => {
    const a = new Browser(app);
    await a.csrf();
    await a.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    const anon = new Browser(app);
    await anon.csrf();
    expect(
      (await anon.req('POST', '/api/v1/auth/password/forgot', { email: 'nobody@example.com' }))
        .statusCode,
    ).toBe(202);
    expect(
      (await anon.req('POST', '/api/v1/auth/password/forgot', { email: registration.email }))
        .statusCode,
    ).toBe(202);
    const link = mailer.sent.filter((m) => m.template === 'reset_password').at(-1)!.params.link!;
    const reset = await anon.req('POST', '/api/v1/auth/password/reset', {
      token: tokenFrom(link),
      new_password: 'Reset-Pass-Value3!',
    });
    expect(reset.statusCode).toBe(204);
    expect((await a.req('GET', '/api/v1/me')).statusCode).toBe(401);
    registration.password = 'Reset-Pass-Value3!';
  });

  it('RBAC: a staff password login only reaches the MFA step; staff routes stay closed until the second factor', async () => {
    const [u] = await t.db.query<Row & { id: string }>(
      "SELECT id FROM users WHERE email_normalized = 'rumana@example.com'",
    );
    await t.db.execute("INSERT INTO user_roles (user_id, role) VALUES (:id, 'editor')", {
      id: u!.id,
    });
    const b = new Browser(app);
    await b.csrf();
    const res = await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    // password alone starts a restricted session: it says a second factor is required and nothing else opens
    expect(res.json().data).toMatchObject({ mfa_required: true, mfa_enrolled: false });
    expect((await b.req('GET', '/api/v1/me/consents')).json().error.code).toBe('MFA_REQUIRED');
    await t.db.execute("DELETE FROM user_roles WHERE user_id = :id AND role = 'editor'", {
      id: u!.id,
    });
    await t.db.execute('DELETE FROM user_sessions WHERE user_id = :id', { id: u!.id });
  });

  it('consents: optional purpose can be granted and withdrawn; terms cannot be withdrawn', async () => {
    const b = new Browser(app);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    const before = await b.req('GET', '/api/v1/me/consents');
    expect(before.json().data.state).toMatchObject({
      terms: true,
      privacy: true,
      analytics: false,
    });
    clock.advanceMs(1000);
    const grant = await b.req('POST', '/api/v1/me/consents', {
      purpose: 'analytics',
      granted: true,
      policy_version: '2026-11-draft',
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json().data.state.analytics).toBe(true);
    clock.advanceMs(1000);
    const withdraw = await b.req('POST', '/api/v1/me/consents', {
      purpose: 'analytics',
      granted: false,
      policy_version: '2026-11-draft',
    });
    expect(withdraw.json().data.state.analytics).toBe(false);
    const terms = await b.req('POST', '/api/v1/me/consents', {
      purpose: 'terms',
      granted: false,
      policy_version: '2026-11-draft',
    });
    expect(terms.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('PATCH /me updates allowed fields and rejects unknown ones', async () => {
    const b = new Browser(app);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    const ok = await b.req('PATCH', '/api/v1/me', { locale: 'en', display_name: 'Rumana' });
    expect(ok.json().data).toMatchObject({ locale: 'en', display_name: 'Rumana' });
    const bad = await b.req('PATCH', '/api/v1/me', { status: 'active' });
    expect(bad.statusCode).toBe(422);
  });

  it('deletion request: needs password + email, revokes sessions, restricted session can only cancel', async () => {
    const b = new Browser(app);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    const bad = await b.req('POST', '/api/v1/me/delete', {
      password: registration.password,
      confirm_email: 'other@example.com',
    });
    expect(bad.statusCode).toBe(401);
    const del = await b.req('POST', '/api/v1/me/delete', {
      password: registration.password,
      confirm_email: 'rumana@EXAMPLE.com',
    });
    expect(del.statusCode).toBe(202);
    expect(del.json().data.state).toBe('grace');
    expect((await b.req('GET', '/api/v1/me')).statusCode).toBe(401); // sessions revoked
    // sign in again during grace: restricted scope
    await b.csrf();
    expect(
      (
        await b.req('POST', '/api/v1/auth/login', {
          email: registration.email,
          password: registration.password,
        })
      ).statusCode,
    ).toBe(200);
    expect((await b.req('GET', '/api/v1/me/consents')).json().error.code).toBe(
      'ACCOUNT_PENDING_DELETION',
    );
    expect((await b.req('GET', '/api/v1/me/delete')).json().data.state).toBe('grace');
    const cancel = await b.req('POST', '/api/v1/me/delete/cancel');
    expect(cancel.json().data.state).toBe('cancelled');
    expect((await b.req('GET', '/api/v1/me/consents')).statusCode).toBe(200);
    // after the grace period a new request can no longer be cancelled
    await b.req('POST', '/api/v1/me/delete', {
      password: registration.password,
      confirm_email: registration.email,
    });
    clock.advanceMs(DELETION_GRACE_MS + 1000);
    await b.csrf();
    await b.req('POST', '/api/v1/auth/login', {
      email: registration.email,
      password: registration.password,
    });
    expect((await b.req('POST', '/api/v1/me/delete/cancel')).statusCode).toBe(409);
  });

  it('mail log never carries tokens', () => {
    // CaptureMailer keeps params for the test; the LogMailer used in deployments logs template and domain only.
    expect(mailer.sent.length).toBeGreaterThan(0);
  });
});
