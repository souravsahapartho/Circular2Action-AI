import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';

/**
 * Database access (plan DBC-08). One pool per process. TiDB Cloud's public endpoint closes connections after
 * 340 s idle and 30 minutes total, so idle connections are dropped after 60 s and any connection older than
 * `maxLifetimeMs` (default 5 minutes) is destroyed instead of being returned to the pool.
 */
export interface DbOptions {
  url: string;
  tls: boolean;
  connectionLimit?: number;
  maxLifetimeMs?: number;
}

export type Row = RowDataPacket;
export type Params = Record<string, unknown> | unknown[];
type QueryValues = Parameters<PoolConnection['query']>[1];

export interface Executor {
  query<T extends Row = Row>(sql: string, params?: Params): Promise<T[]>;
  execute(sql: string, params?: Params): Promise<ResultSetHeader>;
}

export interface Db extends Executor {
  /** Runs `fn` in a transaction; retries on TiDB write conflicts and deadlocks (DBC-04). */
  transaction<T>(fn: (tx: Executor) => Promise<T>, opts?: { retries?: number }): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  readonly pool: Pool;
}

const RETRYABLE = new Set([
  1213, // ER_LOCK_DEADLOCK
  1205, // ER_LOCK_WAIT_TIMEOUT
  8002, // TiDB: SELECT FOR UPDATE write conflict
  8022, // TiDB: transaction commit failed, retry
  9007, // TiDB: write conflict
]);

export function isRetryable(err: unknown): boolean {
  const e = err as { errno?: number; message?: string } | null;
  if (typeof e?.errno === 'number' && RETRYABLE.has(e.errno)) return true;
  // TiDB reports some lock conflicts as a generic error 1105 with a message
  return /pessimistic lock retry limit reached|write conflict|try again later/i.test(
    e?.message ?? '',
  );
}

export function createDb(opts: DbOptions): Db {
  const pool = mysql.createPool({
    uri: opts.url,
    connectionLimit: opts.connectionLimit ?? 10,
    maxIdle: Math.min(opts.connectionLimit ?? 10, 5),
    idleTimeout: 60_000,
    enableKeepAlive: true,
    namedPlaceholders: true,
    supportBigNumbers: true,
    bigNumberStrings: true, // BIGINT ids always come back as strings
    dateStrings: false,
    timezone: 'Z',
    charset: 'utf8mb4_bin',
    ssl: opts.tls ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  });
  const maxLifetime = opts.maxLifetimeMs ?? 5 * 60_000;
  const born = new WeakMap<object, number>();
  pool.on('connection', (c) => {
    born.set(c, Date.now());
    // All DATETIME values are UTC; NOW(3) must agree with what the driver writes (timezone 'Z').
    // Commands on one connection run in order, so this completes before the first query.
    (c as unknown as { query: (sql: string) => void }).query("SET time_zone = '+00:00'");
  });

  async function withConn<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    let broken = false;
    try {
      return await fn(conn);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'PROTOCOL_CONNECTION_LOST' || code === 'ECONNRESET' || code === 'EPIPE') {
        broken = true;
      }
      throw err;
    } finally {
      const raw = (conn as unknown as { connection: object }).connection;
      const age = Date.now() - (born.get(raw) ?? Date.now());
      if (broken || age > maxLifetime) conn.destroy();
      else conn.release();
    }
  }

  // Without parameters, text such as ':name' inside comments or literals must not be parsed as a placeholder.
  const queryOptions = (sql: string, params?: Params) => ({
    sql,
    namedPlaceholders: params !== undefined && !Array.isArray(params),
  });

  const exec = (c: Pick<PoolConnection, 'query'>): Executor => ({
    async query<T extends Row = Row>(sql: string, params?: Params) {
      const [rows] = await c.query<T[]>(queryOptions(sql, params), params as QueryValues);
      return rows;
    },
    async execute(sql: string, params?: Params) {
      const [res] = await c.query<ResultSetHeader>(
        queryOptions(sql, params),
        params as QueryValues,
      );
      return res;
    },
  });

  return {
    pool,
    query: (sql, params) => withConn((c) => exec(c).query(sql, params)),
    execute: (sql, params) => withConn((c) => exec(c).execute(sql, params)),
    async transaction(fn, o) {
      const retries = o?.retries ?? 3;
      for (let attempt = 0; ; attempt++) {
        try {
          return await withConn(async (c) => {
            await c.beginTransaction();
            try {
              const out = await fn(exec(c));
              await c.commit();
              return out;
            } catch (err) {
              await c.rollback().catch(() => undefined);
              throw err;
            }
          });
        } catch (err) {
          if (attempt < retries && isRetryable(err)) {
            await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20));
            continue;
          }
          throw err;
        }
      }
    },
    async ping() {
      const rows = await withConn((c) => exec(c).query('SELECT 1 AS ok'));
      return rows.length === 1;
    },
    close: () => pool.end(),
  };
}
