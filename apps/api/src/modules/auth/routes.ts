import { CONSENT_PURPOSE_LIST, consentState, type ConsentPurpose } from '@c2a/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import type { Mailer } from '../email/mailer';
import { cookieNames, parseCookies, serializeCookie } from './cookies';
import {
  dummyPasswordHash,
  hashPassword,
  hmac,
  needsRehash,
  newToken,
  normalizeEmail,
  passwordProblem,
  sha256,
  verifyPassword,
} from './crypto';
import { issueCsrf } from './csrf';
import { route, type AuthContext, type GuardOptions } from './guard';
import type { AuthRepo } from './repo';

/** Policy text is drafted and awaits counsel (UQ-5); consent events record which version was shown. */
export const POLICY_VERSION = '2026-11-draft';

const DAY = 86_400_000;
export const SESSION_IDLE_MS = 14 * DAY;
export const SESSION_ABSOLUTE_MS = 60 * DAY;
const SESSION_TOUCH_MS = 3_600_000; // slide the idle expiry at most once an hour
const VERIFY_TTL_MS = DAY;
const RESET_TTL_MS = 30 * 60_000;
export const DELETION_GRACE_MS = 7 * DAY;

export interface AuthDeps {
  repo: AuthRepo;
  mailer: Mailer;
  clock: Clock;
  appEnv: 'local' | 'staging' | 'production';
  webOrigin: string;
  webOriginsExtra?: readonly string[];
  /** First internal secret; sub-keys are derived per use. */
  secret: string;
}

const email = z.string().trim().email().max(254);
const password = z.string().min(1).max(1024);
const locale = z.enum(['bn', 'en']);

const registerBody = z.object({
  email,
  password,
  display_name: z.string().trim().min(1).max(100),
  age_confirmed: z.literal(true),
  locale: locale.default('bn'),
  consents: z.object({
    terms: z.literal(true),
    privacy: z.literal(true),
    weekly_digest: z.boolean().optional(),
  }),
});
const loginBody = z.object({ email, password });
const tokenBody = z.object({ token: z.string().min(20).max(200) });
const emailBody = z.object({ email });
const resetBody = z.object({ token: z.string().min(20).max(200), new_password: password });
const changeBody = z.object({ current_password: password, new_password: password });
const patchMeBody = z
  .object({
    display_name: z.string().trim().min(1).max(100).optional(),
    locale: locale.optional(),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/)
      .optional(),
  })
  .strict();
const consentBody = z.object({
  purpose: z.enum(CONSENT_PURPOSE_LIST as [ConsentPurpose, ...ConsentPurpose[]]),
  granted: z.boolean(),
  policy_version: z.string().min(1).max(16),
});
const deleteBody = z.object({ password, confirm_email: email });

function json(req: FastifyRequest): unknown {
  if (typeof req.body !== 'string' || req.body === '') return {};
  try {
    return JSON.parse(req.body);
  } catch {
    throw new AppError('BAD_REQUEST', 'The request body is not valid JSON.');
  }
}

/** Guard options (cookie names, CSRF key, allowed web origins) shared by every module's route() calls. */
export function guardOptionsFor(
  deps: Pick<AuthDeps, 'appEnv' | 'webOrigin' | 'webOriginsExtra' | 'secret'>,
): GuardOptions & { cookies: ReturnType<typeof cookieNames>; csrfKey: string } {
  return {
    cookies: cookieNames(deps.appEnv),
    csrfKey: hmac(deps.secret, 'csrf-key').toString('hex'),
    webOrigin: deps.webOrigin,
    webOriginsExtra: deps.webOriginsExtra ?? [],
  };
}

export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  const { repo, mailer, clock } = deps;
  const g = guardOptionsFor(deps);
  const { cookies, csrfKey } = g;
  const ipKey = hmac(deps.secret, 'ip-hash-key').toString('hex');
  const loginByIp = new RateLimiter(LIMITS.login);
  const loginByAccount = new RateLimiter(LIMITS.login);
  const registerByIp = new RateLimiter(LIMITS.register);

  app.decorateRequest('auth', null);

  // Resolve the session cookie on every request (plan 9.9 sequence).
  app.addHook('preHandler', async (req) => {
    const token = parseCookies(req.headers.cookie)[cookies.session];
    if (!token) return;
    const th = sha256(token);
    const s = await repo.findSession(th);
    const now = clock.now();
    if (!s) return;
    if (s.expires_at <= now || s.absolute_expires_at <= now) {
      await repo.deleteSessionById(s.id);
      return;
    }
    const user = await repo.findUserById(s.user_id);
    if (!user) return;
    if (now.getTime() - s.last_seen_at.getTime() > SESSION_TOUCH_MS) {
      const idle = new Date(
        Math.min(now.getTime() + SESSION_IDLE_MS, s.absolute_expires_at.getTime()),
      );
      await repo.extendSession(s.id, now, idle);
    }
    req.auth = {
      userId: user.id,
      sessionId: s.id,
      tokenHash: th,
      roles: await repo.roles(user.id),
      status: user.status,
      email: user.email,
      locale: user.locale,
      emailVerified: user.email_verified_at !== null,
    } satisfies AuthContext;
  });

  const limit = (rl: RateLimiter, key: string) => {
    const r = rl.take(key, clock.now().getTime());
    if (!r.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many attempts. Please wait and try again.',
        undefined,
        {
          'retry-after': String(r.retryAfterSeconds),
        },
      );
    }
  };

  const setCsrf = (reply: FastifyReply): string => {
    const t = issueCsrf(csrfKey);
    void reply.header(
      'set-cookie',
      serializeCookie(cookies.csrf, t, { secure: cookies.secure, httpOnly: false }),
    );
    return t;
  };

  /** Creates a session, rotates the CSRF token and sets both cookies (rotation on login, plan 9.9). */
  const startSession = async (
    req: FastifyRequest,
    reply: FastifyReply,
    userId: string,
  ): Promise<string> => {
    const token = newToken();
    const now = clock.now();
    await repo.createSession(userId, {
      tokenHash: sha256(token),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
      ipHash: hmac(ipKey, req.ip),
      now,
      idleMs: SESSION_IDLE_MS,
      absoluteMs: SESSION_ABSOLUTE_MS,
    });
    const csrf = issueCsrf(csrfKey);
    void reply.header('set-cookie', [
      serializeCookie(cookies.session, token, {
        secure: cookies.secure,
        httpOnly: true,
        maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000,
      }),
      serializeCookie(cookies.csrf, csrf, { secure: cookies.secure, httpOnly: false }),
    ]);
    return csrf;
  };

  const clearSession = (reply: FastifyReply) => {
    void reply.header(
      'set-cookie',
      serializeCookie(cookies.session, '', {
        secure: cookies.secure,
        httpOnly: true,
        maxAgeSeconds: 0,
      }),
    );
  };

  const sendVerification = async (userId: string, to: string, loc: 'bn' | 'en') => {
    const token = newToken();
    await repo.createAuthToken(userId, {
      purpose: 'verify_email',
      tokenHash: sha256(token),
      expiresAt: new Date(clock.now().getTime() + VERIFY_TTL_MS),
    });
    await mailer.send({
      to,
      template: 'verify_email',
      locale: loc,
      params: { link: `${deps.webOrigin}/${loc}/verify-email?token=${token}` },
    });
  };

  const me = async (a: AuthContext) => {
    const user = (await repo.findUserById(a.userId))!;
    return {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      locale: user.locale,
      status: user.status,
      email_verified: user.email_verified_at !== null,
      roles: a.roles,
    };
  };

  route(app, g, {
    method: 'GET',
    url: '/api/v1/auth/csrf',
    access: 'public',
    handler: async (_req, reply) => ({ data: { csrf_token: setCsrf(reply) } }),
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/register',
    access: 'public',
    handler: async (req, reply) => {
      limit(registerByIp, req.ip);
      const b = registerBody.parse(json(req));
      const problem = passwordProblem(b.password);
      if (problem)
        throw new AppError('VALIDATION_ERROR', problem, [
          { path: 'password', code: 'weak', message: problem },
        ]);
      const en = normalizeEmail(b.email);
      const now = clock.now();
      const created = await repo.createUser({
        email: b.email.trim(),
        emailNormalized: en,
        passwordHash: await hashPassword(b.password),
        displayName: b.display_name,
        locale: b.locale,
        now,
        policyVersion: POLICY_VERSION,
        consents: [
          { purpose: 'terms', granted: true },
          { purpose: 'privacy', granted: true },
          { purpose: 'weekly_digest', granted: b.consents.weekly_digest === true },
        ],
      });
      if (created) {
        await sendVerification(created.id, b.email.trim(), b.locale);
      } else {
        // Same response either way (no account enumeration); the owner is told someone tried.
        const existing = await repo.findUserByEmail(en);
        if (existing) {
          await mailer.send({
            to: existing.email,
            template: 'security_notice',
            locale: existing.locale,
            params: { event: 'register_attempt' },
          });
        }
      }
      return reply
        .status(202)
        .send({ data: { message: 'If the address can be used, we sent a verification email.' } });
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    access: 'public',
    handler: async (req, reply) => {
      const b = tokenBody.parse(json(req));
      const userId = await repo.consumeAuthToken('verify_email', sha256(b.token), clock.now());
      if (!userId) throw new AppError('GONE', 'This link has expired or was already used.');
      await repo.markEmailVerified(userId, clock.now());
      const user = (await repo.findUserById(userId))!;
      if (user.status !== 'active')
        throw new AppError('ACCOUNT_SUSPENDED', 'This account cannot sign in.');
      const csrf = await startSession(req, reply, userId);
      return { data: { user_id: userId, csrf_token: csrf } };
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    access: 'public',
    handler: async (req, reply) => {
      limit(registerByIp, req.ip);
      const b = emailBody.parse(json(req));
      const u = await repo.findUserByEmail(normalizeEmail(b.email));
      if (u && !u.email_verified_at && u.status === 'active')
        await sendVerification(u.id, u.email, u.locale);
      return reply
        .status(202)
        .send({ data: { message: 'If the address needs verifying, we sent a new link.' } });
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/login',
    access: 'public',
    handler: async (req, reply) => {
      limit(loginByIp, req.ip);
      const b = loginBody.parse(json(req));
      const en = normalizeEmail(b.email);
      limit(loginByAccount, en);
      const user = await repo.findUserByEmail(en);
      // Constant-time path: verify against a dummy hash when the account does not exist.
      const ok = await verifyPassword(
        user?.password_hash ?? (await dummyPasswordHash()),
        b.password,
      );
      if (!user || !user.password_hash || !ok) {
        throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      if (user.status === 'suspended')
        throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.');
      if (!user.email_verified_at)
        throw new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email first.');
      const roles = await repo.roles(user.id);
      // Staff accounts need TOTP (AUTH-MFA-01); not built yet, so staff cannot sign in at all (deny by default).
      if (roles.some((r) => r !== 'user')) {
        throw new AppError('MFA_REQUIRED', 'Staff sign-in requires two-factor authentication.');
      }
      if (needsRehash(user.password_hash))
        await repo.setPasswordHash(user.id, await hashPassword(b.password));
      await repo.touchLogin(user.id, clock.now());
      const csrf = await startSession(req, reply, user.id);
      return {
        data: {
          user: { id: user.id, display_name: user.display_name, status: user.status },
          csrf_token: csrf,
        },
      };
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/logout',
    access: 'deletion_cancel',
    handler: async (req, reply) => {
      await repo.deleteSession(req.auth!.tokenHash);
      clearSession(reply);
      return reply.status(204).send();
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/password/forgot',
    access: 'public',
    handler: async (req, reply) => {
      limit(registerByIp, req.ip);
      const b = emailBody.parse(json(req));
      const u = await repo.findUserByEmail(normalizeEmail(b.email));
      if (u && u.status === 'active') {
        const token = newToken();
        await repo.createAuthToken(u.id, {
          purpose: 'reset_password',
          tokenHash: sha256(token),
          expiresAt: new Date(clock.now().getTime() + RESET_TTL_MS),
        });
        await mailer.send({
          to: u.email,
          template: 'reset_password',
          locale: u.locale,
          params: { link: `${deps.webOrigin}/${u.locale}/reset-password?token=${token}` },
        });
      }
      return reply.status(202).send({ data: { message: 'If an account exists, we sent a link.' } });
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/password/reset',
    access: 'public',
    handler: async (req, reply) => {
      const b = resetBody.parse(json(req));
      const problem = passwordProblem(b.new_password);
      if (problem) throw new AppError('VALIDATION_ERROR', problem);
      const userId = await repo.consumeAuthToken('reset_password', sha256(b.token), clock.now());
      if (!userId) throw new AppError('GONE', 'This link has expired or was already used.');
      await repo.setPasswordHash(userId, await hashPassword(b.new_password));
      await repo.deleteAllSessions(userId); // SEC-02: reset revokes every session
      return reply.status(204).send();
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/auth/password/change',
    access: 'authenticated',
    handler: async (req, reply) => {
      const a = req.auth!;
      const b = changeBody.parse(json(req));
      const user = (await repo.findUserById(a.userId))!;
      if (!user.password_hash || !(await verifyPassword(user.password_hash, b.current_password))) {
        throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect.');
      }
      const problem = passwordProblem(b.new_password);
      if (problem) throw new AppError('VALIDATION_ERROR', problem);
      await repo.setPasswordHash(a.userId, await hashPassword(b.new_password));
      await repo.deleteAllSessions(a.userId, a.tokenHash); // SEC-02: other sessions revoked
      return reply.status(204).send();
    },
  });

  route(app, g, {
    method: 'GET',
    url: '/api/v1/auth/sessions',
    access: 'authenticated',
    handler: async (req) => {
      const a = req.auth!;
      const rows = await repo.listSessions(a.userId);
      return {
        data: rows.map((s) => ({
          id: s.id,
          user_agent: s.user_agent,
          last_seen_at: s.last_seen_at.toISOString(),
          created_at: s.created_at.toISOString(),
          current: s.token_hash.equals(a.tokenHash),
        })),
      };
    },
  });

  route(app, g, {
    method: 'DELETE',
    url: '/api/v1/auth/sessions/:id',
    access: 'authenticated',
    handler: async (req, reply) => {
      const id = String((req.params as { id: string }).id);
      if (!/^\d{1,20}$/.test(id) || !(await repo.deleteOwnSession(req.auth!.userId, id))) {
        throw new AppError('NOT_FOUND', 'Session not found.');
      }
      return reply.status(204).send();
    },
  });

  route(app, g, {
    method: 'GET',
    url: '/api/v1/me',
    access: 'deletion_cancel',
    handler: async (req) => ({ data: await me(req.auth!) }),
  });

  route(app, g, {
    method: 'PATCH',
    url: '/api/v1/me',
    access: 'authenticated',
    handler: async (req) => {
      await repo.updateMe(req.auth!.userId, patchMeBody.parse(json(req)));
      return { data: await me(req.auth!) };
    },
  });

  route(app, g, {
    method: 'GET',
    url: '/api/v1/me/consents',
    access: 'authenticated',
    handler: async (req) => {
      const user = (await repo.findUserById(req.auth!.userId))!;
      const history = await repo.consentEvents(user.consent_subject_ref);
      return { data: { state: consentState(history), history, policy_version: POLICY_VERSION } };
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/me/consents',
    access: 'authenticated',
    handler: async (req, reply) => {
      const b = consentBody.parse(json(req));
      if ((b.purpose === 'terms' || b.purpose === 'privacy') && !b.granted) {
        throw new AppError(
          'CONSENT_REQUIRED',
          'Terms and privacy consent are needed to keep an account. To withdraw them, delete the account.',
        );
      }
      const user = (await repo.findUserById(req.auth!.userId))!;
      await repo.addConsentEvent(user.consent_subject_ref, {
        purpose: b.purpose,
        granted: b.granted,
        policyVersion: b.policy_version,
        locale: user.locale,
        now: clock.now(),
      });
      const history = await repo.consentEvents(user.consent_subject_ref);
      return reply.status(201).send({ data: { state: consentState(history) } });
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/me/delete',
    access: 'authenticated',
    handler: async (req, reply) => {
      const a = req.auth!;
      const b = deleteBody.parse(json(req));
      const user = (await repo.findUserById(a.userId))!;
      const okPw = user.password_hash
        ? await verifyPassword(user.password_hash, b.password)
        : false;
      if (!okPw || normalizeEmail(b.confirm_email) !== normalizeEmail(user.email)) {
        throw new AppError('INVALID_CREDENTIALS', 'Password or email confirmation is incorrect.');
      }
      const graceEnds = await repo.requestDeletion(a.userId, clock.now(), DELETION_GRACE_MS);
      await mailer.send({
        to: user.email,
        template: 'deletion_requested',
        locale: user.locale,
        params: { grace_ends_at: graceEnds.toISOString() },
      });
      clearSession(reply);
      return reply
        .status(202)
        .send({ data: { state: 'grace', grace_ends_at: graceEnds.toISOString() } });
    },
  });

  route(app, g, {
    method: 'GET',
    url: '/api/v1/me/delete',
    access: 'deletion_cancel',
    handler: async (req) => {
      const s = await repo.deletionStatus(req.auth!.userId);
      if (!s) throw new AppError('NOT_FOUND', 'No deletion request.');
      return {
        data: {
          state: s.state,
          requested_at: s.requested_at.toISOString(),
          grace_ends_at: s.grace_ends_at.toISOString(),
        },
      };
    },
  });

  route(app, g, {
    method: 'POST',
    url: '/api/v1/me/delete/cancel',
    access: 'deletion_cancel',
    handler: async (req) => {
      if (!(await repo.cancelDeletion(req.auth!.userId, clock.now()))) {
        throw new AppError('CONFLICT', 'There is no deletion that can still be cancelled.');
      }
      return { data: { state: 'cancelled' } };
    },
  });
}
