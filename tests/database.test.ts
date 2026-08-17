/**
 * Tests for the PostgreSQL connection pool (src/database/pool.ts)
 * Covers: SUPABASE_DATABASE_URL wiring, connection success/failure,
 * shutdown behavior, and that credentials are never logged.
 */

import { Pool } from 'pg';

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    end: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mPool) };
});

import {
  createPool,
  getPool,
  testConnection,
  disconnectPool,
  __resetPoolForTests
} from '../src/database/pool';

describe('Database pool (pg)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPoolForTests();
  });

  describe('createPool', () => {
    it('constructs a pg Pool using the provided connection string', () => {
      createPool('postgresql://user:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres');

      expect(Pool).toHaveBeenCalledTimes(1);
      const config = (Pool as unknown as jest.Mock).mock.calls[0][0];
      expect(config.connectionString).toBe(
        'postgresql://user:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
      );
    });

    it('enables certificate verification rather than disabling TLS validation', () => {
      createPool('postgresql://user:pass@host:5432/postgres');

      const config = (Pool as unknown as jest.Mock).mock.calls[0][0];
      expect(config.ssl).toBeDefined();
      expect(config.ssl.rejectUnauthorized).toBe(true);
    });

    it('returns the existing pool instance if already initialized', () => {
      const first = createPool('postgresql://user:pass@host:5432/postgres');
      const second = createPool('postgresql://user:pass@other-host:5432/postgres');

      expect(first).toBe(second);
      expect(Pool).toHaveBeenCalledTimes(1);
    });

    it('registers an error listener so pool-level errors are logged, not thrown', () => {
      const pool = createPool('postgresql://user:pass@host:5432/postgres');
      expect((pool as any).on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('getPool', () => {
    it('throws a clear error when called before createPool', () => {
      expect(() => getPool()).toThrow('PostgreSQL pool not initialized');
    });

    it('returns the initialized pool', () => {
      const created = createPool('postgresql://user:pass@host:5432/postgres');
      expect(getPool()).toBe(created);
    });
  });

  describe('testConnection', () => {
    it('returns true when the database responds', async () => {
      const pool = createPool('postgresql://user:pass@host:5432/postgres');
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await testConnection(pool);

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns false (does not throw) when the database is unreachable', async () => {
      const pool = createPool('postgresql://user:pass@host:5432/postgres');
      (pool.query as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));

      const result = await testConnection(pool);

      expect(result).toBe(false);
    });
  });

  describe('disconnectPool', () => {
    it('closes the pool and clears the singleton so a later createPool works again', async () => {
      const pool = createPool('postgresql://user:pass@host:5432/postgres');

      await disconnectPool();

      expect(pool.end).toHaveBeenCalledTimes(1);
      expect(() => getPool()).toThrow('PostgreSQL pool not initialized');
    });

    it('is a no-op when no pool was ever created', async () => {
      await expect(disconnectPool()).resolves.toBeUndefined();
    });

    it('propagates errors from pool.end() after logging, and still clears the singleton', async () => {
      const pool = createPool('postgresql://user:pass@host:5432/postgres');
      (pool.end as jest.Mock).mockRejectedValueOnce(new Error('shutdown failed'));

      await expect(disconnectPool()).rejects.toThrow('shutdown failed');
      expect(() => getPool()).toThrow('PostgreSQL pool not initialized');
    });
  });

  describe('secret handling', () => {
    it('never includes the connection string in a thrown/logged error message', async () => {
      const secretUrl = 'postgresql://postgres:sup3rSecretPassword@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
      const pool = createPool(secretUrl);
      (pool.query as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await testConnection(pool);

      const loggedOutput = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(loggedOutput).not.toContain('sup3rSecretPassword');
      expect(loggedOutput).not.toContain(secretUrl);

      consoleSpy.mockRestore();
    });
  });
});
