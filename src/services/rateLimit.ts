/**
 * Rate limiting service for Bot Kun v2
 * Implements 10 interactions per user per 20 minutes
 * Uses bounded in-memory storage with automatic cleanup
 */

import { RATE_LIMIT_MAX_INTERACTIONS, RATE_LIMIT_WINDOW_MS } from '../config';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  windowStart: number;
  lastReset: number;
}

export class RateLimitService {
  private userLimits: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean up every 5 minutes
  private readonly MAX_CACHE_SIZE = 10000; // Maximum number of users to track

  constructor() {
    this.startCleanupTask();
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanupTask(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    logger.debug('Rate limit cleanup task started');
  }

  /**
   * Clean up expired entries and enforce cache size limit
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, entry] of this.userLimits.entries()) {
      // Remove entries whose window has completely expired
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        this.userLimits.delete(userId);
        cleaned++;
      }
    }

    // If cache is still too large, remove oldest entries
    if (this.userLimits.size > this.MAX_CACHE_SIZE) {
      const entriesToRemove = this.userLimits.size - this.MAX_CACHE_SIZE;
      let removed = 0;
      
      for (const [userId] of this.userLimits.entries()) {
        if (removed >= entriesToRemove) break;
        this.userLimits.delete(userId);
        removed++;
      }

      logger.warn(`Rate limit cache exceeded max size, removed ${removed} oldest entries`);
    }

    if (cleaned > 0) {
      logger.debug(`Rate limit cleanup: removed ${cleaned} expired entries`);
    }
  }

  /**
   * Check if user can interact (not rate limited)
   * Returns object with allowed status and time until reset if limited
   */
  canInteract(userId: string): { allowed: boolean; resetTime?: number } {
    const now = Date.now();
    const entry = this.userLimits.get(userId);

    // No entry exists, user can interact
    if (!entry) {
      return { allowed: true };
    }

    // Check if the current window has expired
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      // Window expired, reset count
      entry.count = 0;
      entry.windowStart = now;
      return { allowed: true };
    }

    // Check if user has exceeded limit
    if (entry.count >= RATE_LIMIT_MAX_INTERACTIONS) {
      const resetTime = entry.windowStart + RATE_LIMIT_WINDOW_MS;
      return { allowed: false, resetTime };
    }

    // User can interact
    return { allowed: true };
  }

  /**
   * Record an interaction for a user
   */
  recordInteraction(userId: string): void {
    const now = Date.now();
    let entry = this.userLimits.get(userId);

    if (!entry) {
      // Create new entry
      entry = {
        count: 1,
        windowStart: now,
        lastReset: now
      };
      this.userLimits.set(userId, entry);
    } else {
      // Check if window has expired
      if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
        // Reset for new window
        entry.count = 1;
        entry.windowStart = now;
        entry.lastReset = now;
      } else {
        // Increment count in current window
        entry.count++;
      }
    }

    logger.debug(`Interaction recorded for user ${userId}: ${entry.count}/${RATE_LIMIT_MAX_INTERACTIONS}`);
  }

  /**
   * Get current interaction count for a user
   */
  getCurrentCount(userId: string): number {
    const entry = this.userLimits.get(userId);
    if (!entry) return 0;

    const now = Date.now();
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      return 0;
    }

    return entry.count;
  }

  /**
   * Get time until rate limit resets for a user
   */
  getResetTime(userId: string): number | null {
    const entry = this.userLimits.get(userId);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      return null;
    }

    return entry.windowStart + RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Clear all rate limit data (useful for testing)
   */
  clearAll(): void {
    this.userLimits.clear();
    logger.debug('All rate limit data cleared');
  }

  /**
   * Clear rate limit data for a specific user
   */
  clearUser(userId: string): void {
    this.userLimits.delete(userId);
    logger.debug(`Rate limit data cleared for user ${userId}`);
  }

  /**
   * Get current cache size for monitoring
   */
  getCacheSize(): number {
    return this.userLimits.size;
  }

  /**
   * Stop cleanup task (for graceful shutdown)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('Rate limit cleanup task stopped');
    }
  }
}

export const rateLimitService = new RateLimitService();
