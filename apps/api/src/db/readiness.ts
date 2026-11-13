import type { ReadinessCheck } from '../app';
import type { Db } from './pool';

/** /readyz database check: a ping with a timeout, so an unreachable or unconfigured database reports 503. */
export function databaseCheck(db: Db | null, timeoutMs = 3000): ReadinessCheck {
  return {
    name: 'database',
    check: async () => {
      if (!db) return false; // DATABASE_URL not configured: not ready
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      try {
        return await Promise.race([db.ping(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
