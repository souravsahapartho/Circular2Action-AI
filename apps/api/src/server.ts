import { buildApp } from './app';
import { createDb } from './db/pool';
import { databaseCheck } from './db/readiness';
import { AuthRepo } from './modules/auth/repo';
import { LogMailer } from './modules/email/mailer';
import { AdminRepo } from './modules/admin/repo';
import { MeRepo } from './modules/me/repo';
import { OpportunityRepo } from './modules/opportunities/repo';
import { loadConfig } from './platform/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = config.DATABASE_URL
    ? createDb({
        url: config.DATABASE_URL,
        tls: config.DATABASE_TLS,
        connectionLimit: config.DATABASE_POOL_SIZE,
      })
    : null;
  const app = buildApp({
    config,
    readiness: [databaseCheck(db)],
    ...(db
      ? {
          opportunities: { repo: new OpportunityRepo(db) },
          me: { repo: new MeRepo(db) },
          admin: { repo: new AdminRepo(db) },
          auth: {
            repo: new AuthRepo(db),
            mailer: new LogMailer((o, m) => console.warn(m, JSON.stringify(o))),
          },
        }
      : {}),
  });

  // Graceful shutdown (plan SCH-04): stop accepting work, finish in-flight requests, exit before the platform SIGKILL.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), config.SHUTDOWN_GRACE_SECONDS * 1000);
    timer.unref();
    await app.close();
    await db?.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ tier: config.HOSTING_TIER, env: config.APP_ENV }, 'api started');
}

main().catch((err) => {
  // configuration errors are printed without secrets and stop the process
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
