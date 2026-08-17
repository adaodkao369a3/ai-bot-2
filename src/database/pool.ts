/**
 * PostgreSQL connection pool for Bot Kun v2
 *
 * Connects directly to Supabase-hosted PostgreSQL using the `pg` driver
 * against SUPABASE_DATABASE_URL. This replaces the earlier @supabase/supabase-js
 * (PostgREST) client, which was never the intended architecture for this project.
 *
 * Never logs the connection string or any credential material.
 */

import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

/**
 * Determine SSL configuration for the Supabase pooler connection.
 *
 * Supabase's hosted pooler (Supavisor/PgBouncer) presents a certificate issued
 * by a publicly trusted CA - it is NOT self-signed. That means the safe,
 * correct setting is standard certificate verification (rejectUnauthorized: true),
 * not rejectUnauthorized: false. Disabling verification would allow a
 * man-in-the-middle to intercept the connection undetected and is only ever
 * appropriate for self-hosted Supabase instances presenting a private CA -
 * which is not the deployment target here.
 *
 * We deliberately build the ssl option as an object (rather than relying on
 * a `sslmode` query parameter in the connection string) because node-postgres
 * silently ignores the `ssl` config object whenever the connection string
 * contains an `sslmode` parameter. Keeping TLS config here, in one place,
 * avoids that foot-gun.
 */
function resolveSslConfig(): PoolConfig['ssl'] {
  return { rejectUnauthorized: true };
}

export function createPool(connectionString: string): Pool {
  if (pool) {
    logger.warn('PostgreSQL pool already initialized, returning existing instance');
    return pool;
  }

  try {
    logger.info('Initializing PostgreSQL connection pool...');

    pool = new Pool({
      connectionString,
      ssl: resolveSslConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    // Surface pool-level errors (e.g. an idle client losing its connection)
    // instead of letting them crash the process silently.
    pool.on('error', (error) => {
      logger.error('Unexpected PostgreSQL pool error', {
        error: error.message
      });
    });

    logger.info('PostgreSQL connection pool initialized');
    return pool;
  } catch (error) {
    logger.error('Failed to initialize PostgreSQL connection pool', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call createPool first.');
  }
  return pool;
}

/**
 * Run a parameterized query against the pool.
 * Centralizing this makes it easy to confirm every call site is parameterized.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const activePool = getPool();
  return activePool.query<T>(text, params);
}

export async function testConnection(targetPool: Pool): Promise<boolean> {
  try {
    logger.info('Testing PostgreSQL connection...');
    await targetPool.query('SELECT 1');
    logger.info('PostgreSQL connection test successful');
    return true;
  } catch (error) {
    logger.error('PostgreSQL connection test failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

export async function disconnectPool(): Promise<void> {
  if (pool) {
    logger.info('Closing PostgreSQL connection pool...');
    try {
      await pool.end();
      logger.info('PostgreSQL connection pool closed');
    } catch (error) {
      logger.error('Error while closing PostgreSQL connection pool', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      pool = null;
    }
  }
}

/**
 * For tests only: reset the module-level singleton so each test can start
 * from a clean state without reaching into module internals.
 */
export function __resetPoolForTests(): void {
  pool = null;
}
