/**
 * Bot state management for Bocchi
 * Handles global enabled/disabled state with PostgreSQL persistence
 */

import { getPool } from '../database/pool';
import { logger } from '../utils/logger';

interface GuildSettingRow {
  guild_id: string;
  bot_enabled: boolean;
}

export class BotStateService {
  private cache: Map<string, boolean> = new Map();
  private cacheInitialized = false;

  /**
   * Initialize the cache by loading all guild states from the database
   */
  async initialize(): Promise<void> {
    if (this.cacheInitialized) {
      logger.debug('Bot state cache already initialized');
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<GuildSettingRow>(
        `SELECT guild_id, bot_enabled FROM guild_settings`
      );

      // Populate cache with database state
      for (const setting of rows) {
        this.cache.set(setting.guild_id, setting.bot_enabled);
      }

      this.cacheInitialized = true;
      logger.info(`Bot state cache initialized with ${this.cache.size} guilds`);
    } catch (error) {
      logger.error('Failed to initialize bot state cache', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if bot is enabled for a guild
   * Defaults to true if no setting exists
   */
  async isEnabled(guildId: string): Promise<boolean> {
    // Check cache first
    if (this.cache.has(guildId)) {
      return this.cache.get(guildId)!;
    }

    // If not in cache, fetch from database
    try {
      const pool = getPool();
      const { rows } = await pool.query<GuildSettingRow>(
        `SELECT bot_enabled FROM guild_settings WHERE guild_id = $1 LIMIT 1`,
        [guildId]
      );

      if (rows.length === 0) {
        // No record found, default to enabled
        logger.debug(`No bot state found for guild ${guildId}, defaulting to enabled`);
        this.cache.set(guildId, true);
        return true;
      }

      const enabled = rows[0].bot_enabled ?? true;
      this.cache.set(guildId, enabled);
      return enabled;
    } catch (error) {
      logger.error('Failed to check bot enabled state', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Default to enabled on error to avoid breaking functionality
      return true;
    }
  }

  /**
   * Set bot enabled/disabled state for a guild
   */
  async setEnabled(guildId: string, enabled: boolean): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO guild_settings (guild_id, bot_enabled)
         VALUES ($1, $2)
         ON CONFLICT (guild_id)
         DO UPDATE SET bot_enabled = EXCLUDED.bot_enabled, updated_at = NOW()`,
        [guildId, enabled]
      );

      // Update cache
      this.cache.set(guildId, enabled);
      logger.info(`Bot state updated for guild ${guildId}: ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      logger.error('Failed to set bot enabled state', {
        guildId,
        enabled,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Enable bot for a guild
   */
  async enable(guildId: string): Promise<void> {
    await this.setEnabled(guildId, true);
  }

  /**
   * Disable bot for a guild
   */
  async disable(guildId: string): Promise<void> {
    await this.setEnabled(guildId, false);
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheInitialized = false;
    logger.debug('Bot state cache cleared');
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

export const botStateService = new BotStateService();
