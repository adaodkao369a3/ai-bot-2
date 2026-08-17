/**
 * PostgreSQL connection pool for Bot Kun v2
 *
 * Connects directly to Supabase-hosted PostgreSQL using the `pg` driver
 * against SUPABASE_DATABASE_URL. This replaces the earlier @supabase/supabase-js
 * (PostgREST) client, which was never the intended architecture for this project.
 *
 * Never logs the connection string or any credential material.
 */

import fs from 'fs';
import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

/**
 * Read an optional CA certificate for verify-full style TLS validation.
 *
 * Either SUPABASE_DB_CA_CERT (the PEM contents directly, e.g. pasted into a
 * Railway variable) or SUPABASE_DB_CA_CERT_PATH (a path to a mounted file)
 * can be set. Neither is required - this is an opt-in upgrade path, never a
 * secret in itself (CA certificates are public by design).
 */
function readCaCertFromEnv(): string | undefined {
  const inline = process.env.SUPABASE_DB_CA_CERT;
  if (inline && inline.trim().length > 0) {
    return inline;
  }

  const path = process.env.SUPABASE_DB_CA_CERT_PATH;
  if (path) {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (error) {
      logger.error('Failed to read SUPABASE_DB_CA_CERT_PATH, ignoring it', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return undefined;
}

/**
 * Determine SSL configuration for the Supabase pooler connection.
 *
 * Supabase's own edge certificate is publicly trusted, but on some proxied
 * paths (Railway's TCP proxy in front of the Supavisor/PgBouncer pooler,
 * observed here) Node is handed an intermediate chain it cannot validate
 * against its default trust store, and rejects it as
 * "self-signed certificate in certificate chain" even though the connection
 * itself is genuinely TLS-encrypted.
 *
 * Preferred fix: set SUPABASE_DB_CA_CERT (or _PATH) to the project's CA
 * certificate from Supabase Dashboard -> Database -> SSL Configuration. When
 * present, we verify the server against it (rejectUnauthorized: true), which
 * is the "verify-full" equivalent and defeats MITM attacks.
 *
 * Fallback: if no CA is configured, we use rejectUnauthorized: false so the
 * bot can actually start. The connection is still encrypted; what's lost is
 * server-identity verification, so this only protects against passive
 * eavesdropping, not an active MITM. This is a known, common trade-off for
 * this exact Supabase/Railway pairing and is why the CA-cert path above is
 * offered as the secure upgrade.
 */
function resolveSslConfig(): PoolConfig['ssl'] {
  const ca = readCaCertFromEnv();
  if (ca) {
    logger.info('PostgreSQL SSL: CA certificate configured, using full certificate verification');
    return { rejectUnauthorized: true, ca };
  }

  logger.warn(
    'PostgreSQL SSL: no CA certificate configured (SUPABASE_DB_CA_CERT / SUPABASE_DB_CA_CERT_PATH). ' +
    'Falling back to rejectUnauthorized: false so the pool can connect through the Railway/Supavisor ' +
    'proxy chain. Traffic is still encrypted, but the server certificate is not verified. Set ' +
    'SUPABASE_DB_CA_CERT_PATH (or SUPABASE_DB_CA_CERT) to enable full verification.'
  );
  return { rejectUnauthorized: false };
}

/**
 * node-postgres silently ignores the `ssl` config object whenever the
 * connection string itself contains an `sslmode` query parameter - the
 * string wins and the object above is never applied. Strip it so the
 * behavior is deterministic and always driven by resolveSslConfig().
 */
function stripConflictingSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.has('sslmode')) {
      logger.warn(
        'SUPABASE_DATABASE_URL contains an sslmode parameter, which node-postgres would let ' +
        'silently override the pool\'s explicit ssl config. Ignoring it in favor of the ' +
        'explicit configuration so TLS behavior is deterministic.'
      );
      url.searchParams.delete('sslmode');
    }
    return url.toString();
  } catch {
    // Not a strictly parseable URL (e.g. missing encoding) - fall back to
    // using it as-is rather than risk mangling a working connection string.
    return connectionString;
  }
}

export function createPool(connectionString: string): Pool {
  if (pool) {
    logger.warn('PostgreSQL pool already initialized, returning existing instance');
    return pool;
  }

  try {
    logger.info('Initializing PostgreSQL connection pool...');

    pool = new Pool({
      connectionString: stripConflictingSslParams(connectionString),
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
