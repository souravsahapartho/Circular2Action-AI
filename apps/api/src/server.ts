import { buildApp } from './app';
import { createDb } from './db/pool';
import { databaseCheck } from './db/readiness';
import { AuthRepo } from './modules/auth/repo';
import { LogMailer } from './modules/email/mailer';
import { AdminRepo } from './modules/admin/repo';
import { AdminInsights } from './modules/admin/insights';
import { EmployerRepo } from './modules/employer/repo';
import { PushService } from './modules/push/service';
import { SponsoredRepo } from './modules/sponsored/repo';
import { ApplicationRepo } from './modules/applications/repo';
import { ListingRepo } from './modules/listings/repo';
import { buildConnectors } from './modules/listings/sources';
import { MeRepo } from './modules/me/repo';
import { RecommendService } from './modules/recommend/service';
import { OpportunityRepo } from './modules/opportunities/repo';
import { systemClock } from './platform/clock';
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
  const adminRepo = db ? new AdminRepo(db) : null;
  const meRepo = db ? new MeRepo(db) : null;
  const oppRepo = db ? new OpportunityRepo(db) : null;
  const push = db
    ? new PushService(db, systemClock, {
        publicKey: config.VAPID_PUBLIC_KEY,
        privateKey: config.VAPID_PRIVATE_KEY,
        subject: config.VAPID_SUBJECT,
      })
    : null;
  const app = buildApp({
    config,
    readiness: [databaseCheck(db)],
    ...(db
      ? {
          opportunities: { repo: oppRepo! },
          me: { repo: meRepo! },
          recommend: { service: new RecommendService(db, meRepo!, oppRepo!, systemClock) },
          admin: { repo: adminRepo! },
          employer: { repo: new EmployerRepo(db, adminRepo!, systemClock) },
          push: { service: push! },
          sponsored: { repo: new SponsoredRepo(db, systemClock) },
          applications: { repo: new ApplicationRepo(db) },
          adminInsights: { insights: new AdminInsights(db, systemClock) },
          listings: {
            repo: new ListingRepo(
              db,
              buildConnectors({
                googleKey: config.GOOGLE_CSE_API_KEY,
                googleCx: config.GOOGLE_CSE_CX,
                googleQuery: config.GOOGLE_CSE_QUERY,
              }),
              systemClock,
            ),
          },
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

  // Send pending push notifications shortly after they are created. The timer only runs while the service is awake.
  if (push?.enabled) {
    const timer = setInterval(() => void push.flush().catch(() => undefined), 20_000);
    timer.unref();
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ tier: config.HOSTING_TIER, env: config.APP_ENV }, 'api started');
}

main().catch((err) => {
  // configuration errors are printed without secrets and stop the process
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
