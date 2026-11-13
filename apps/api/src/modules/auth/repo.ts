import { randomBytes } from 'node:crypto';
import type { ConsentPurpose, Role } from '@c2a/contracts';
import type { Db, Executor, Row } from '../../db/pool';

/** SQL for identity, sessions, tokens and consent. User-owned queries take `userId` first (SEC-07). */

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  status: 'active' | 'suspended' | 'pending_deletion';
  locale: 'bn' | 'en';
  email_verified_at: Date | null;
  consent_subject_ref: Buffer;
}

export interface SessionRow {
  id: string;
  user_id: string;
  last_seen_at: Date;
  expires_at: Date;
  absolute_expires_at: Date;
}

export class AuthRepo {
  constructor(private readonly db: Db) {}

  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async findUserByEmail(emailNormalized: string): Promise<UserRow | null> {
    const rows = await this.db.query<Row & UserRow>(
      `SELECT id, email, display_name, password_hash, status, locale, email_verified_at, consent_subject_ref
       FROM users WHERE email_normalized = :e`,
      { e: emailNormalized },
    );
    return rows[0] ? { ...rows[0], id: String(rows[0].id) } : null;
  }

  async findUserById(userId: string): Promise<UserRow | null> {
    const rows = await this.db.query<Row & UserRow>(
      `SELECT id, email, display_name, password_hash, status, locale, email_verified_at, consent_subject_ref
       FROM users WHERE id = :id`,
      { id: userId },
    );
    return rows[0] ? { ...rows[0], id: String(rows[0].id) } : null;
  }

  /** Inserts the user, the `user` role and the consent events in one transaction. Null if the email exists. */
  async createUser(input: {
    email: string;
    emailNormalized: string;
    passwordHash: string;
    displayName: string;
    locale: 'bn' | 'en';
    now: Date;
    consents: Array<{ purpose: ConsentPurpose; granted: boolean }>;
    policyVersion: string;
  }): Promise<{ id: string; subjectRef: Buffer } | null> {
    const subjectRef = randomBytes(16);
    try {
      return await this.db.transaction(async (tx) => {
        const res = await tx.execute(
          `INSERT INTO users (email, email_normalized, password_hash, display_name, locale, age_confirmed_at, consent_subject_ref)
           VALUES (:email, :en, :ph, :dn, :loc, :now, :ref)`,
          {
            email: input.email,
            en: input.emailNormalized,
            ph: input.passwordHash,
            dn: input.displayName,
            loc: input.locale,
            now: input.now,
            ref: subjectRef,
          },
        );
        const id = String(res.insertId);
        await tx.execute(`INSERT INTO user_roles (user_id, role) VALUES (:id, 'user')`, { id });
        for (const c of input.consents) {
          await tx.execute(
            `INSERT INTO consent_events (subject_ref, purpose, granted, policy_version, locale, created_at)
             VALUES (:ref, :p, :g, :v, :loc, :now)`,
            {
              ref: subjectRef,
              p: c.purpose,
              g: c.granted ? 1 : 0,
              v: input.policyVersion,
              loc: input.locale,
              now: input.now,
            },
          );
        }
        return { id, subjectRef };
      });
    } catch (err) {
      if ((err as { errno?: number }).errno === 1062) return null;
      throw err;
    }
  }

  async roles(userId: string): Promise<Role[]> {
    const rows = await this.db.query<Row & { role: Role }>(
      'SELECT role FROM user_roles WHERE user_id = :id',
      { id: userId },
    );
    return rows.map((r) => r.role);
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.execute('UPDATE users SET password_hash = :ph WHERE id = :id', {
      id: userId,
      ph: passwordHash,
    });
  }

  async touchLogin(userId: string, now: Date): Promise<void> {
    await this.db.execute('UPDATE users SET last_login_at = :now WHERE id = :id', {
      id: userId,
      now,
    });
  }

  // --- sessions ---

  async createSession(
    userId: string,
    s: {
      tokenHash: Buffer;
      userAgent: string | null;
      ipHash: Buffer | null;
      now: Date;
      idleMs: number;
      absoluteMs: number;
    },
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_hash, last_seen_at, expires_at, absolute_expires_at)
       VALUES (:uid, :th, :ua, :ip, :now, :exp, :abs)`,
      {
        uid: userId,
        th: s.tokenHash,
        ua: s.userAgent?.slice(0, 255) ?? null,
        ip: s.ipHash,
        now: s.now,
        exp: new Date(s.now.getTime() + s.idleMs),
        abs: new Date(s.now.getTime() + s.absoluteMs),
      },
    );
  }

  async findSession(tokenHash: Buffer): Promise<SessionRow | null> {
    const rows = await this.db.query<Row & SessionRow>(
      `SELECT id, user_id, last_seen_at, expires_at, absolute_expires_at FROM user_sessions WHERE token_hash = :th`,
      { th: tokenHash },
    );
    const r = rows[0];
    return r ? { ...r, id: String(r.id), user_id: String(r.user_id) } : null;
  }

  async extendSession(sessionId: string, now: Date, expiresAt: Date): Promise<void> {
    await this.db.execute(
      'UPDATE user_sessions SET last_seen_at = :now, expires_at = :exp WHERE id = :id',
      { id: sessionId, now, exp: expiresAt },
    );
  }

  async deleteSession(tokenHash: Buffer): Promise<void> {
    await this.db.execute('DELETE FROM user_sessions WHERE token_hash = :th', { th: tokenHash });
  }

  async deleteSessionById(sessionId: string): Promise<void> {
    await this.db.execute('DELETE FROM user_sessions WHERE id = :id', { id: sessionId });
  }

  async deleteAllSessions(userId: string, exceptTokenHash?: Buffer): Promise<number> {
    const res = exceptTokenHash
      ? await this.db.execute(
          'DELETE FROM user_sessions WHERE user_id = :uid AND token_hash <> :th',
          {
            uid: userId,
            th: exceptTokenHash,
          },
        )
      : await this.db.execute('DELETE FROM user_sessions WHERE user_id = :uid', { uid: userId });
    return res.affectedRows;
  }

  async countSessions(userId: string): Promise<number> {
    const [r] = await this.db.query<Row & { n: number }>(
      'SELECT COUNT(*) n FROM user_sessions WHERE user_id = :uid',
      { uid: userId },
    );
    return Number(r!.n);
  }

  // --- single-use tokens ---

  async createAuthToken(
    userId: string,
    t: { purpose: 'verify_email' | 'reset_password'; tokenHash: Buffer; expiresAt: Date },
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (:uid, :p, :th, :exp)`,
      { uid: userId, p: t.purpose, th: t.tokenHash, exp: t.expiresAt },
    );
  }

  /** Atomically marks a valid, unused token as used; returns its user id or null. */
  async consumeAuthToken(
    purpose: 'verify_email' | 'reset_password',
    tokenHash: Buffer,
    now: Date,
  ): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<Row & { id: string; user_id: string }>(
        `SELECT id, user_id FROM auth_tokens
         WHERE token_hash = :th AND purpose = :p AND used_at IS NULL AND expires_at > :now FOR UPDATE`,
        { th: tokenHash, p: purpose, now },
      );
      const r = rows[0];
      if (!r) return null;
      await tx.execute('UPDATE auth_tokens SET used_at = :now WHERE id = :id', { id: r.id, now });
      return String(r.user_id);
    });
  }

  async markEmailVerified(userId: string, now: Date): Promise<void> {
    await this.db.execute(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, :now) WHERE id = :id',
      { id: userId, now },
    );
  }

  // --- consent ---

  async consentEvents(
    subjectRef: Buffer,
  ): Promise<Array<{ purpose: ConsentPurpose; granted: boolean; at: string }>> {
    const rows = await this.db.query<
      Row & { purpose: ConsentPurpose; granted: number; created_at: Date }
    >(
      'SELECT purpose, granted, created_at FROM consent_events WHERE subject_ref = :ref ORDER BY created_at',
      { ref: subjectRef },
    );
    return rows.map((r) => ({
      purpose: r.purpose,
      granted: Number(r.granted) === 1,
      at: r.created_at.toISOString(),
    }));
  }

  async addConsentEvent(
    subjectRef: Buffer,
    e: {
      purpose: ConsentPurpose;
      granted: boolean;
      policyVersion: string;
      locale: string;
      now: Date;
    },
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO consent_events (subject_ref, purpose, granted, policy_version, locale, created_at)
       VALUES (:ref, :p, :g, :v, :loc, :now)`,
      {
        ref: subjectRef,
        p: e.purpose,
        g: e.granted ? 1 : 0,
        v: e.policyVersion,
        loc: e.locale,
        now: e.now,
      },
    );
  }

  // --- deletion ---

  /** DEL-01: account becomes pending_deletion, every session is revoked, a grace-period request is recorded. */
  async requestDeletion(userId: string, now: Date, graceMs: number): Promise<Date> {
    const graceEnds = new Date(now.getTime() + graceMs);
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE users SET status = 'pending_deletion', deletion_requested_at = :now WHERE id = :id AND status = 'active'`,
        { id: userId, now },
      );
      await tx.execute(
        `INSERT INTO deletion_requests (user_id, state, requested_at, grace_ends_at) VALUES (:id, 'grace', :now, :g)`,
        { id: userId, now, g: graceEnds },
      );
      await tx.execute('DELETE FROM user_sessions WHERE user_id = :id', { id: userId });
    });
    return graceEnds;
  }

  async deletionStatus(
    userId: string,
  ): Promise<{ state: string; requested_at: Date; grace_ends_at: Date } | null> {
    const rows = await this.db.query<
      Row & { state: string; requested_at: Date; grace_ends_at: Date }
    >(
      `SELECT state, requested_at, grace_ends_at FROM deletion_requests WHERE user_id = :id
       ORDER BY requested_at DESC LIMIT 1`,
      { id: userId },
    );
    return rows[0] ?? null;
  }

  /** DEL-02: cancel during the grace period only. */
  async cancelDeletion(userId: string, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const res = await tx.execute(
        `UPDATE deletion_requests SET state = 'cancelled'
         WHERE user_id = :id AND state = 'grace' AND grace_ends_at > :now`,
        { id: userId, now },
      );
      if (res.affectedRows === 0) return false;
      await tx.execute(
        `UPDATE users SET status = 'active', deletion_requested_at = NULL WHERE id = :id AND status = 'pending_deletion'`,
        { id: userId },
      );
      return true;
    });
  }

  async listSessions(
    userId: string,
  ): Promise<
    Array<{
      id: string;
      user_agent: string | null;
      last_seen_at: Date;
      created_at: Date;
      token_hash: Buffer;
    }>
  > {
    const rows = await this.db.query<
      Row & {
        id: string;
        user_agent: string | null;
        last_seen_at: Date;
        created_at: Date;
        token_hash: Buffer;
      }
    >(
      `SELECT id, user_agent, last_seen_at, created_at, token_hash FROM user_sessions
       WHERE user_id = :uid ORDER BY last_seen_at DESC`,
      { uid: userId },
    );
    return rows.map((r) => ({ ...r, id: String(r.id) }));
  }

  /** Deletes one of the user's own sessions; false if it is not theirs. */
  async deleteOwnSession(userId: string, sessionId: string): Promise<boolean> {
    const res = await this.db.execute(
      'DELETE FROM user_sessions WHERE id = :sid AND user_id = :uid',
      {
        sid: sessionId,
        uid: userId,
      },
    );
    return res.affectedRows === 1;
  }

  async updateMe(
    userId: string,
    patch: { display_name?: string; locale?: 'bn' | 'en'; timezone?: string },
  ): Promise<void> {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id: userId };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = :${k}`);
      params[k] = v;
    }
    if (sets.length === 0) return;
    await this.db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = :id`, params);
  }
}
