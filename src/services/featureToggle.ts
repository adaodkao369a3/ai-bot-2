/**
 * Feature toggle management for Bocchi
 * Handles per-guild feature enable/disable states with PostgreSQL persistence
 */

import { getPool } from '../database/pool';
import { logger } from '../utils/logger';

export type Feature = 'youtube' | 'confession' | 'gif' | 'meme';

interface FeatureSettingRow {
  guild_id: string;
  feature_name: string;
  enabled: boolean;
}

export class FeatureToggleService {
  private cache: Map<string, Map<Feature, boolean>> = new Map();
  private cacheInitialized = false;

  /**
   * Initialize the cache by loading all feature states from the database
   */
  async initialize(): Promise<void> {
    if (this.cacheInitialized) {
      logger.debug('Feature toggle cache already initialized');
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<FeatureSettingRow>(
        `SELECT guild_id, feature_name, enabled FROM feature_toggles`
      );

      // Populate cache with database state
      for (const setting of rows) {
        const feature = setting.feature_name as Feature;
        if (!this.cache.has(setting.guild_id)) {
          this.cache.set(setting.guild_id, new Map());
        }
        this.cache.get(setting.guild_id)!.set(feature, setting.enabled);
      }

      this.cacheInitialized = true;
      logger.info(`Feature toggle cache initialized with ${this.cache.size} guilds`);
    } catch (error) {
      logger.error('Failed to initialize feature toggle cache', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if a feature is enabled for a guild
   * Defaults to true if no setting exists
   */
  async isEnabled(guildId: string, feature: Feature): Promise<boolean> {
    // Check cache first
    if (this.cache.has(guildId) && this.cache.get(guildId)!.has(feature)) {
      return this.cache.get(guildId)!.get(feature)!;
    }

    // If not in cache, fetch from database
    try {
      const pool = getPool();
      const { rows } = await pool.query<FeatureSettingRow>(
        `SELECT enabled FROM feature_toggles WHERE guild_id = $1 AND feature_name = $2 LIMIT 1`,
        [guildId, feature]
      );

      if (rows.length === 0) {
        // No record found, default to enabled
        logger.debug(`No feature toggle found for guild ${guildId} feature ${feature}, defaulting to enabled`);
        if (!this.cache.has(guildId)) {
          this.cache.set(guildId, new Map());
        }
        this.cache.get(guildId)!.set(feature, true);
        return true;
      }

      const enabled = rows[0].enabled ?? true;
      if (!this.cache.has(guildId)) {
        this.cache.set(guildId, new Map());
      }
      this.cache.get(guildId)!.set(feature, enabled);
      return enabled;
    } catch (error) {
      logger.error('Failed to check feature enabled state', {
        guildId,
        feature,
        error: error instanceof Error ? error.message : String(error)
      });
      // Default to enabled on error to avoid breaking functionality
      return true;
    }
  }

  /**
   * Set feature enabled/disabled state for a guild
   */
  async setEnabled(guildId: string, feature: Feature, enabled: boolean): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO feature_toggles (guild_id, feature_name, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, feature_name)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [guildId, feature, enabled]
      );

      // Update cache
      if (!this.cache.has(guildId)) {
        this.cache.set(guildId, new Map());
      }
      this.cache.get(guildId)!.set(feature, enabled);
      logger.info(`Feature toggle updated for guild ${guildId} feature ${feature}: ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      logger.error('Failed to set feature enabled state', {
        guildId,
        feature,
        enabled,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Enable a feature for a guild
   */
  async enable(guildId: string, feature: Feature): Promise<void> {
    await this.setEnabled(guildId, feature, true);
  }

  /**
   * Disable a feature for a guild
   */
  async disable(guildId: string, feature: Feature): Promise<void> {
    await this.setEnabled(guildId, feature, false);
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheInitialized = false;
    logger.debug('Feature toggle cache cleared');
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

export const featureToggleService = new FeatureToggleService();
