/**
 * Blacklist service for Bot Kun v2
 * Manages user blacklisting with Supabase persistence
 */

import { getSupabaseClient } from '../database/supabase';
import { logger } from '../utils/logger';

export class BlacklistService {
  private cache: Map<string, Set<string>> = new Map(); // guildId -> Set of userIds
  private cacheInitialized = false;

  /**
   * Initialize the cache by loading all blacklists from Supabase
   */
  async initialize(): Promise<void> {
    if (this.cacheInitialized) {
      logger.debug('Blacklist cache already initialized');
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('blacklist')
        .select('user_id, guild_id');

      if (error) {
        throw error;
      }

      // Populate cache with database state
      if (data) {
        for (const entry of data) {
          if (!this.cache.has(entry.guild_id)) {
            this.cache.set(entry.guild_id, new Set());
          }
          this.cache.get(entry.guild_id)!.add(entry.user_id);
        }
      }

      this.cacheInitialized = true;
      logger.info(`Blacklist cache initialized with ${data?.length || 0} entries`);
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
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('blacklist')
        .select('user_id')
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No record found, not blacklisted
          return false;
        }
        throw error;
      }

      const isBlacklisted = !!data;
      
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
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('blacklist')
        .insert({
          user_id: userId,
          guild_id: guildId,
          blacklisted_by: blacklistedBy,
          reason: reason || null
        });

      if (error) {
        throw error;
      }

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
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('blacklist')
        .delete()
        .eq('user_id', userId)
        .eq('guild_id', guildId);

      if (error) {
        throw error;
      }

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
