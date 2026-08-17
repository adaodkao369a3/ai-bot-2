/**
 * Blacklist service for Bot Kun v2
 * Manages user blacklisting with PostgreSQL persistence
 */

import { getPool } from '../database/pool';
import { logger } from '../utils/logger';

interface BlacklistRow {
  user_id: string;
  guild_id: string;
}

export class BlacklistService {
  private cache: Map<string, Set<string>> = new Map(); // guildId -> Set of userIds
  private cacheInitialized = false;

  /**
   * Initialize the cache by loading all blacklists from the database
   */
  async initialize(): Promise<void> {
    if (this.cacheInitialized) {
      logger.debug('Blacklist cache already initialized');
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<BlacklistRow>(
        `SELECT user_id, guild_id FROM blacklist`
      );

      // Populate cache with database state
      for (const entry of rows) {
        if (!this.cache.has(entry.guild_id)) {
          this.cache.set(entry.guild_id, new Set());
        }
        this.cache.get(entry.guild_id)!.add(entry.user_id);
      }

      this.cacheInitialized = true;
      logger.info(`Blacklist cache initialized with ${rows.length} entries`);
    } catch (error) {
      logger.error('Failed to initialize blacklist cache', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if a user is blacklisted in a guild
   */
  async isBlacklisted(userId: string, guildId: string): Promise<boolean> {
    // Check cache first
    const guildBlacklist = this.cache.get(guildId);
    if (guildBlacklist) {
      return guildBlacklist.has(userId);
    }

    // If not in cache, fetch from database
    try {
      const pool = getPool();
      const { rows } = await pool.query<BlacklistRow>(
        `SELECT user_id FROM blacklist WHERE user_id = $1 AND guild_id = $2 LIMIT 1`,
        [userId, guildId]
      );

      const isBlacklisted = rows.length > 0;

      // Update cache
      if (isBlacklisted) {
        if (!this.cache.has(guildId)) {
          this.cache.set(guildId, new Set());
        }
        this.cache.get(guildId)!.add(userId);
      }

      return isBlacklisted;
    } catch (error) {
      logger.error('Failed to check blacklist status', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Default to not blacklisted on error to avoid breaking functionality
      return false;
    }
  }

  /**
   * Add a user to the blacklist
   * Only users with appropriate permissions can blacklist others
   */
  async addToBlacklist(
    userId: string,
    guildId: string,
    blacklistedBy: string,
    reason?: string
  ): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO blacklist (user_id, guild_id, blacklisted_by, reason)
         VALUES ($1, $2, $3, $4)`,
        [userId, guildId, blacklistedBy, reason ?? null]
      );

      // Update cache
      if (!this.cache.has(guildId)) {
        this.cache.set(guildId, new Set());
      }
      this.cache.get(guildId)!.add(userId);

      logger.info(`User ${userId} blacklisted in guild ${guildId} by ${blacklistedBy}`, {
        reason
      });
    } catch (error) {
      logger.error('Failed to add user to blacklist', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Remove a user from the blacklist
   */
  async removeFromBlacklist(userId: string, guildId: string): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `DELETE FROM blacklist WHERE user_id = $1 AND guild_id = $2`,
        [userId, guildId]
      );

      // Update cache
      const guildBlacklist = this.cache.get(guildId);
      if (guildBlacklist) {
        guildBlacklist.delete(userId);
      }

      logger.info(`User ${userId} removed from blacklist in guild ${guildId}`);
    } catch (error) {
      logger.error('Failed to remove user from blacklist', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheInitialized = false;
    logger.debug('Blacklist cache cleared');
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    let total = 0;
    for (const set of this.cache.values()) {
      total += set.size;
    }
    return total;
  }
}

export const blacklistService = new BlacklistService();
