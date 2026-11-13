import { hasPermission, type Permission, type Role } from '@c2a/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { AppError } from '../../platform/errors';
import { parseCookies, type CookieNames } from './cookies';
import { originAllowed, verifyCsrf } from './csrf';

/** What a route needs (SEC-06: there is no route without one of these). */
export type Access =
  | 'public'
  | 'authenticated' // signed-in, active account
  | 'deletion_cancel' // signed-in, active or pending deletion (DEL-02 restricted scope)
  | Permission;

export interface AuthContext {
  userId: string;
  sessionId: string;
  tokenHash: Buffer;
  roles: Role[];
  status: 'active' | 'suspended' | 'pending_deletion';
  email: string;
  locale: 'bn' | 'en';
  emailVerified: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export interface GuardOptions {
  cookies: CookieNames;
  csrfKey: string;
  webOrigin: string;
  webOriginsExtra?: readonly string[];
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Builds a preHandler that enforces access, CSRF (double submit) and Origin for state-changing methods. */
export function guard(access: Access, opts: GuardOptions) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!SAFE.has(req.method)) {
      if (!originAllowed(req.headers.origin, [opts.webOrigin, ...(opts.webOriginsExtra ?? [])])) {
        throw new AppError('CSRF_FAILED', 'Request origin is not allowed.');
      }
      const cookies = parseCookies(req.headers.cookie);
      const header = req.headers['x-csrf-token'];
      if (
        !verifyCsrf(
          opts.csrfKey,
          cookies[opts.cookies.csrf],
          typeof header === 'string' ? header : undefined,
        )
      ) {
        throw new AppError(
          'CSRF_FAILED',
          'Your session form expired. Please reload the page and try again.',
        );
      }
    }
    if (access === 'public') return;
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
    if (auth.status === 'suspended')
      throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.');
    if (access === 'deletion_cancel') return;
    if (auth.status === 'pending_deletion') {
      throw new AppError('ACCOUNT_PENDING_DELETION', 'This account is scheduled for deletion.');
    }
    if (access === 'authenticated') return;
    if (!hasPermission(auth.roles, access))
      throw new AppError('FORBIDDEN', 'You do not have access to this.');
  };
}

/** The only way modules register routes: `access` is mandatory (SEC-06 deny by default). */
export function route(
  app: FastifyInstance,
  opts: GuardOptions,
  def: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    access: Access;
    handler: RouteHandlerMethod;
  },
): void {
  app.route({
    method: def.method,
    url: def.url,
    preHandler: guard(def.access, opts),
    handler: def.handler,
  });
}
