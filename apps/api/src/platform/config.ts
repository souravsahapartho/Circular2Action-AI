import { z } from 'zod';

/**
 * Centralised, validated configuration (plan SEC-33). The process refuses to start with missing or malformed
 * configuration. No other module reads process.env.
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    /** Additional allowed web origins (comma separated), e.g. a second hosting of the same web app. */
    WEB_ORIGINS_EXTRA: z
      .string()
      .default('')
      .refine(
        (v) =>
          v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
            .every((x) => z.string().url().safeParse(x).success),
        'WEB_ORIGINS_EXTRA must be comma-separated URLs',
      ),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** E0 = free (dev/test/closed alpha), E1/E2 = paid always-on production (plan section 9.14). */
    HOSTING_TIER: z.enum(['free', 'paid']).default('free'),
    SCHEDULER_MODE: z.enum(['inprocess', 'external', 'cron']).default('inprocess'),
    SCHEDULER_INTERVAL_MIN: z.coerce.number().int().min(1).max(1440).default(30),
    SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().min(1).max(300).default(100),
    /** Comma-separated; first is current, others are previous (rotation without downtime). */
    INTERNAL_HMAC_SECRETS: z.string().min(1),
    AI_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
    AI_ENABLE_PAID: bool,
    AI_ENABLE_FREE: bool,
    AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(10),
    EMAIL_PROVIDER: z.enum(['resend', 'ses', 'log']).default('log'),
    EMAIL_DAILY_CAP: z.coerce.number().int().min(0).default(80),
    EMAIL_RESERVED_SECURITY_PCT: z.coerce.number().int().min(0).max(100).default(60),
    /**
     * When false, new accounts are marked verified at registration (staging only, while no email provider exists).
     * Production must keep it true (plan 5 Module F2, S-7).
     */
    EMAIL_VERIFICATION_REQUIRED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Runtime database user (DML only). mysql://user:pass@host:port/db */
    DATABASE_URL: z.string().url().optional(),
    /** TLS is required for TiDB Cloud; off only for the local container. */
    DATABASE_TLS: bool,
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** Optional Google Programmable Search connector for the web jobs feed (free tier: 100 queries a day). */
    GOOGLE_CSE_API_KEY: z.string().min(10).optional(),
    GOOGLE_CSE_CX: z.string().min(3).optional(),
    GOOGLE_CSE_QUERY: z.string().min(3).max(200).optional(),
    VAPID_PUBLIC_KEY: z.string().min(40).max(200).optional(),
    VAPID_PRIVATE_KEY: z.string().min(20).max(200).optional(),
    VAPID_SUBJECT: z.string().min(8).max(200).optional(),
  })
  .superRefine((env, ctx) => {
    // SCH-02: no keep-alive. A free instance must really sleep between ticks.
    if (env.HOSTING_TIER === 'free' && env.SCHEDULER_INTERVAL_MIN < 30) {
      ctx.addIssue({
        code: 'custom',
        path: ['SCHEDULER_INTERVAL_MIN'],
        message:
          'A tick interval below 30 minutes on a free instance is a keep-alive and is forbidden (SCH-02)',
      });
    }
    if (env.APP_ENV === 'production' && env.HOSTING_TIER === 'free') {
      ctx.addIssue({
        code: 'custom',
        path: ['HOSTING_TIER'],
        message: 'Production must not run on the free hosting tier (plan section 9.14)',
      });
    }
    if (env.APP_ENV === 'production' && env.AI_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'The mock AI provider cannot run in production',
      });
    }
    if (env.APP_ENV === 'production' && !env.EMAIL_VERIFICATION_REQUIRED) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_VERIFICATION_REQUIRED'],
        message: 'Email verification cannot be disabled in production',
      });
    }
    if (env.APP_ENV !== 'local' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required outside local development',
      });
    }
    if (env.APP_ENV !== 'local' && env.DATABASE_URL && !env.DATABASE_TLS) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_TLS'],
        message: 'DATABASE_TLS must be true outside local development (TiDB Cloud requires TLS)',
      });
    }
    const secrets = env.INTERNAL_HMAC_SECRETS.split(',').map((s) => s.trim());
    if (secrets.some((s) => s.length < 32)) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_HMAC_SECRETS'],
        message: 'Every internal HMAC secret must be at least 32 characters',
      });
    }
  });

export type Config = Omit<
  z.infer<typeof envSchema>,
  'INTERNAL_HMAC_SECRETS' | 'WEB_ORIGINS_EXTRA'
> & {
  hmacSecrets: string[];
  webOriginsExtra: string[];
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const { INTERNAL_HMAC_SECRETS, WEB_ORIGINS_EXTRA, ...rest } = parsed.data;
  return {
    ...rest,
    hmacSecrets: INTERNAL_HMAC_SECRETS.split(',').map((s) => s.trim()),
    webOriginsExtra: WEB_ORIGINS_EXTRA.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

const migrationSchema = z.object({
  /** DDL-capable user used only by the migration command (plan section 11.16). Falls back to DATABASE_URL. */
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_TLS: bool,
});

export interface MigrationConfig {
  url: string;
  tls: boolean;
}

export function loadMigrationConfig(
  env: Record<string, string | undefined> = process.env,
): MigrationConfig {
  const parsed = migrationSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid migration configuration');
  const url = parsed.data.DATABASE_MIGRATION_URL ?? parsed.data.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_MIGRATION_URL (or DATABASE_URL) to run migrations');
  return { url, tls: parsed.data.DATABASE_TLS };
}

/** Seed command settings: demo data is allowed only with ALLOW_DEMO_SEED=true (never in production). */
export function loadSeedConfig(
  env: Record<string, string | undefined> = process.env,
): MigrationConfig & { allowDemo: boolean } {
  return { ...loadMigrationConfig(env), allowDemo: env.ALLOW_DEMO_SEED === 'true' };
}

/** First staff account: read from the environment by `pnpm --filter @c2a/api create-admin` (never logged). */
export function loadAdminConfig(
  env: Record<string, string | undefined> = process.env,
): MigrationConfig & { email: string; password: string } {
  const base = loadMigrationConfig(env);
  const email = env.ADMIN_EMAIL?.trim() ?? '';
  const password = env.ADMIN_PASSWORD ?? '';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid address');
  if ([...password].length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  return { ...base, email, password };
}
