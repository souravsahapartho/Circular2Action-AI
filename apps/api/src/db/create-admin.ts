import { hashPassword, normalizeEmail } from '../modules/auth/crypto';
import { AuthRepo } from '../modules/auth/repo';
import { POLICY_VERSION } from '../modules/auth/routes';
import { loadAdminConfig } from '../platform/config';
import { createDb } from './pool';

/**
 * Creates (or resets) the first super admin. Staff must enrol two-factor on first sign-in (AUTH-MFA-01), so a
 * leaked password alone cannot open the admin area. The password comes from ADMIN_PASSWORD and is never printed.
 */
async function main(): Promise<void> {
  const cfg = loadAdminConfig();
  const db = createDb({ url: cfg.url, tls: cfg.tls, connectionLimit: 2 });
  const repo = new AuthRepo(db);
  try {
    const en = normalizeEmail(cfg.email);
    const hash = await hashPassword(cfg.password);
    let user = await repo.findUserByEmail(en);
    if (user) {
      await repo.setPasswordHash(user.id, hash);
      await repo.deleteAllSessions(user.id);
      console.warn('existing account: password reset, sessions revoked');
    } else {
      const created = await repo.createUser({
        email: cfg.email.trim(),
        emailNormalized: en,
        passwordHash: hash,
        displayName: 'Administrator',
        locale: 'en',
        now: new Date(),
        policyVersion: POLICY_VERSION,
        consents: [
          { purpose: 'terms', granted: true },
          { purpose: 'privacy', granted: true },
        ],
      });
      if (!created) throw new Error('could not create the account');
      user = await repo.findUserByEmail(en);
      console.warn('account created');
    }
    await repo.markEmailVerified(user!.id, new Date());
    await db.execute("INSERT IGNORE INTO user_roles (user_id, role) VALUES (:id, 'super_admin')", {
      id: user!.id,
    });
    console.warn('super_admin role granted; two-factor enrolment happens at first sign-in');
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
