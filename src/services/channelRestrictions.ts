/**
 * Channel restrictions service for Bocchi
 * Manages which channels the bot is allowed to respond in per guild
 */

import { getPool } from '../database/pool';
import { logger } from '../utils/logger';

interface ChannelRestrictionRow {
  guild_id: string;
  channel_id: string;
  created_at: Date;
}

export class ChannelRestrictionsService {
  private cache: Map<string, Set<string>> = new Map(); // guild_id -> Set of channel_ids
  private cacheInitialized = false;

  /**
   * Initialize the cache by loading all channel restrictions from the database
   */
  async initialize(): Promise<void> {
    if (this.cacheInitialized) {
      logger.debug('Channel restrictions cache already initialized');
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<ChannelRestrictionRow>(
        `SELECT guild_id, channel_id FROM channel_restrictions`
      );

      // Populate cache with database state
      for (const row of rows) {
        if (!this.cache.has(row.guild_id)) {
          this.cache.set(row.guild_id, new Set());
        }
        this.cache.get(row.guild_id)!.add(row.channel_id);
      }

      this.cacheInitialized = true;
      logger.info(`Channel restrictions cache initialized with ${this.cache.size} guilds`);
    } catch (error) {
      logger.error('Failed to initialize channel restrictions cache', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if a channel is allowed for a guild
   * Returns true if no restrictions exist (allow all by default)
   */
  async isChannelAllowed(guildId: string, channelId: string): Promise<boolean> {
    // Check cache first
    if (this.cache.has(guildId)) {
      const allowedChannels = this.cache.get(guildId)!;
      // If no restrictions are set, allow all channels
      if (allowedChannels.size === 0) {
        return true;
      }
      // If restrictions exist, check if channel is in the allowed set
      return allowedChannels.has(channelId);
    }

    // If not in cache, fetch from database
    try {
      const pool = getPool();
      const { rows } = await pool.query<ChannelRestrictionRow>(
        `SELECT channel_id FROM channel_restrictions WHERE guild_id = $1`,
        [guildId]
      );

      if (rows.length === 0) {
        // No restrictions for this guild, allow all channels
        this.cache.set(guildId, new Set());
        return true;
      }

      // Restrictions exist, check if channel is allowed
      const allowedChannels = new Set(rows.map(row => row.channel_id));
      this.cache.set(guildId, allowedChannels);
      return allowedChannels.has(channelId);
    } catch (error) {
      logger.error('Failed to check channel restriction', {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Default to allowed on error to avoid breaking functionality
      return true;
    }
  }

  /**
   * Get all allowed channels for a guild
   */
  async getAllowedChannels(guildId: string): Promise<string[]> {
    // Check cache first
    if (this.cache.has(guildId)) {
      return Array.from(this.cache.get(guildId)!);
    }

    // If not in cache, fetch from database
    try {
      const pool = getPool();
      const { rows } = await pool.query<ChannelRestrictionRow>(
        `SELECT channel_id FROM channel_restrictions WHERE guild_id = $1`,
        [guildId]
      );

      const channelIds = rows.map(row => row.channel_id);
      this.cache.set(guildId, new Set(channelIds));
      return channelIds;
    } catch (error) {
      logger.error('Failed to get allowed channels', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Add a channel to the allowed list for a guild
   */
  async addChannel(guildId: string, channelId: string): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO channel_restrictions (guild_id, channel_id)
         VALUES ($1, $2)
         ON CONFLICT (guild_id, channel_id) DO NOTHING`,
        [guildId, channelId]
      );

      // Update cache
      if (!this.cache.has(guildId)) {
        this.cache.set(guildId, new Set());
      }
      this.cache.get(guildId)!.add(channelId);
      logger.info(`Channel ${channelId} added to allowed list for guild ${guildId}`);
    } catch (error) {
      logger.error('Failed to add channel restriction', {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Remove a channel from the allowed list for a guild
   */
  async removeChannel(guildId: string, channelId: string): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `DELETE FROM channel_restrictions WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId]
      );

      // Update cache
      if (this.cache.has(guildId)) {
        this.cache.get(guildId)!.delete(channelId);
      }
      logger.info(`Channel ${channelId} removed from allowed list for guild ${guildId}`);
    } catch (error) {
      logger.error('Failed to remove channel restriction', {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Clear all channel restrictions for a guild (allow all channels)
   */
  async clearRestrictions(guildId: string): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `DELETE FROM channel_restrictions WHERE guild_id = $1`,
        [guildId]
      );

      // Update cache
      this.cache.set(guildId, new Set());
      logger.info(`All channel restrictions cleared for guild ${guildId}`);
    } catch (error) {
      logger.error('Failed to clear channel restrictions', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if a guild has any restrictions set
   */
  async hasRestrictions(guildId: string): Promise<boolean> {
    const allowedChannels = await this.getAllowedChannels(guildId);
    return allowedChannels.length > 0;
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheInitialized = false;
    logger.debug('Channel restrictions cache cleared');
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

export const channelRestrictionsService = new ChannelRestrictionsService();
