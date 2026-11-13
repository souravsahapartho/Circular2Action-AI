import { buildApp } from './app';
import { loadConfig } from './platform/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp({ config });

  // Graceful shutdown (plan SCH-04): stop accepting work, finish in-flight requests, exit before the platform SIGKILL.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), config.SHUTDOWN_GRACE_SECONDS * 1000);
    timer.unref();
    await app.close();
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
