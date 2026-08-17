/**
 * Memory service for Bot Kun v2
 * Handles user profiles and long-term memory operations against PostgreSQL
 */

import { getPool } from '../database/pool';
import { 
  MEMORY_ACTIVE_MEMBER_CAP, 
  MEMORY_CONFIDENCE_THRESHOLD, 
  MEMORY_MAX_CONFIDENCE,
  MEMORY_CONFIDENCE_INCREMENT,
  MEMORY_RETRIEVAL_LIMIT
} from '../config';
import { permissionService } from './permissions';
import { logger } from '../utils/logger';
import { MemoryCandidate, MemoryType } from './memoryExtraction';

export interface UserProfile {
  userId: string;
  guildId: string;
  username?: string;
  displayName?: string;
  memoryEligible: boolean;
  isExtra: boolean;
  isFeaturedExtra: boolean;
  isSupportingCast: boolean;
  lastInteractionAt?: Date;
}

export interface Memory {
  id?: string;
  userId: string;
  guildId: string;
  content: string;
  normalizedContent?: string;
  confidence: number;
  frequency: number;
  confirmationCount: number;
  type: MemoryType;
  source: string;
  lastAccessedAt?: Date;
  firstObservedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  isActive?: boolean;
}

interface UserProfileRow {
  id: string;
  user_id: string;
  guild_id: string;
  username: string | null;
  display_name: string | null;
  memory_eligible: boolean;
  extra_role_id: string | null;
  is_extra: boolean;
  is_featured_extra: boolean;
  is_supporting_cast: boolean;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserMemoryRow {
  id: string;
  user_id: string;
  guild_id: string;
  memory_content: string;
  normalized_content: string | null;
  confidence: string | number;
  frequency: number;
  confirmation_count: number;
  memory_type: string | null;
  source: string;
  last_accessed_at: string | null;
  first_observed_at: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export class MemoryService {
  /**
   * Get or create user profile
   */
  async getOrCreateProfile(
    userId: string,
    guildId: string,
    username?: string,
    displayName?: string
  ): Promise<UserProfile> {
    try {
      const pool = getPool();

      // Try to get existing profile
      const { rows: existingRows } = await pool.query<UserProfileRow>(
        `SELECT * FROM user_profiles WHERE user_id = $1 AND guild_id = $2 LIMIT 1`,
        [userId, guildId]
      );
      const existingProfile = existingRows[0];

      if (existingProfile) {
        // Update profile if user info changed
        if (username || displayName) {
          try {
            await pool.query(
              `UPDATE user_profiles
               SET username = $1, display_name = $2, updated_at = NOW()
               WHERE user_id = $3 AND guild_id = $4`,
              [
                username || existingProfile.username,
                displayName || existingProfile.display_name,
                userId,
                guildId
              ]
            );
          } catch (updateError) {
            logger.warn('Failed to update user profile', {
              error: updateError instanceof Error ? updateError.message : String(updateError)
            });
          }
        }

        return this.mapDbProfileToInterface(existingProfile);
      }

      // Create new profile
      const { rows: newRows } = await pool.query<UserProfileRow>(
        `INSERT INTO user_profiles
           (user_id, guild_id, username, display_name, memory_eligible, is_extra, is_featured_extra, is_supporting_cast)
         VALUES ($1, $2, $3, $4, false, false, false, false)
         RETURNING *`,
        [userId, guildId, username || null, displayName || null]
      );

      logger.debug(`Created new profile for user ${userId} in guild ${guildId}`);
      return this.mapDbProfileToInterface(newRows[0]);
    } catch (error) {
      logger.error('Failed to get or create user profile', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update user's memory eligibility based on roles
   */
  async updateMemoryEligibility(
    userId: string,
    guildId: string,
    member: any // GuildMember
  ): Promise<void> {
    try {
      const isEligible = permissionService.hasMemoryEligibility(member);
      const isExtra = permissionService.isExtra(member);
      const isFeaturedExtra = permissionService.isFeaturedExtra(member);
      const isSupportingCast = permissionService.isSupportingCast(member);

      const extraRoleId = isEligible
        ? member.roles.cache.find((_r: any) =>
            [isExtra, isFeaturedExtra, isSupportingCast].includes(true)
          )?.id ?? null
        : null;

      const pool = getPool();
      await pool.query(
        `UPDATE user_profiles
         SET memory_eligible = $1,
             is_extra = $2,
             is_featured_extra = $3,
             is_supporting_cast = $4,
             extra_role_id = $5,
             updated_at = NOW()
         WHERE user_id = $6 AND guild_id = $7`,
        [isEligible, isExtra, isFeaturedExtra, isSupportingCast, extraRoleId, userId, guildId]
      );

      logger.debug(`Updated memory eligibility for user ${userId}: ${isEligible}`);
    } catch (error) {
      logger.error('Failed to update memory eligibility', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update last interaction timestamp
   */
  async updateLastInteraction(userId: string, guildId: string): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `UPDATE user_profiles
         SET last_interaction_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND guild_id = $2`,
        [userId, guildId]
      );
    } catch (error) {
      logger.error('Failed to update last interaction', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Non-critical error, don't throw
    }
  }

  /**
   * Check if user is in active memory pool
   */
  async isInActiveMemoryPool(userId: string, guildId: string): Promise<boolean> {
    try {
      const pool = getPool();
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

      // Count eligible users with recent interactions
      const { rows: countRows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM user_profiles
         WHERE guild_id = $1 AND memory_eligible = true AND last_interaction_at > $2`,
        [guildId, cutoff]
      );
      const count = parseInt(countRows[0]?.count ?? '0', 10);

      // If under cap, user is automatically in pool
      if (count < MEMORY_ACTIVE_MEMBER_CAP) {
        return true;
      }

      // Check if user is in top N by last interaction
      const { rows: topUsers } = await pool.query<{ user_id: string }>(
        `SELECT user_id
         FROM user_profiles
         WHERE guild_id = $1 AND memory_eligible = true AND last_interaction_at > $2
         ORDER BY last_interaction_at DESC
         LIMIT $3`,
        [guildId, cutoff, MEMORY_ACTIVE_MEMBER_CAP]
      );

      return topUsers.some(u => u.user_id === userId);
    } catch (error) {
      logger.error('Failed to check active memory pool', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Add a memory for a user
   */
  async addMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_memories
           (user_id, guild_id, memory_content, normalized_content, confidence, frequency,
            confirmation_count, memory_type, source, last_accessed_at, first_observed_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11)
         RETURNING id`,
        [
          memory.userId,
          memory.guildId,
          memory.content,
          memory.normalizedContent ?? null,
          memory.confidence,
          memory.frequency,
          memory.confirmationCount,
          memory.type,
          memory.source,
          memory.firstObservedAt ? memory.firstObservedAt.toISOString() : new Date().toISOString(),
          memory.isActive !== undefined ? memory.isActive : true
        ]
      );

      logger.debug(`Added memory for user ${memory.userId}: ${memory.content.substring(0, 50)}...`);
      return rows[0].id;
    } catch (error) {
      logger.error('Failed to add memory', {
        userId: memory.userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Find similar existing memories for a candidate
   */
  async findSimilarMemories(userId: string, guildId: string, candidate: MemoryCandidate): Promise<Memory[]> {
    try {
      const pool = getPool();
      const { rows } = await pool.query<UserMemoryRow>(
        `SELECT * FROM user_memories
         WHERE user_id = $1 AND guild_id = $2 AND memory_type = $3 AND is_active = true
         LIMIT 20`,
        [userId, guildId, candidate.type]
      );

      if (rows.length === 0) {
        return [];
      }

      // Calculate similarity and filter
      const similar = rows
        .map(db => this.mapDbMemoryToInterface(db))
        .filter(memory => this.calculateSimilarity(candidate.normalizedContent, memory.normalizedContent || '') >= 0.6);

      return similar;
    } catch (error) {
      logger.error('Failed to find similar memories', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Update an existing memory with new confirmation
   */
  async updateMemoryConfirmation(memoryId: string): Promise<void> {
    try {
      const pool = getPool();

      // Get current memory
      const { rows: currentRows } = await pool.query<UserMemoryRow>(
        `SELECT * FROM user_memories WHERE id = $1 LIMIT 1`,
        [memoryId]
      );

      if (currentRows.length === 0) {
        throw new Error(`Memory ${memoryId} not found`);
      }

      const current = currentRows[0];
      const currentConfidence = typeof current.confidence === 'string'
        ? parseFloat(current.confidence)
        : current.confidence;

      // Calculate new confidence (capped at max)
      const newConfidence = Math.min(
        MEMORY_MAX_CONFIDENCE,
        currentConfidence + MEMORY_CONFIDENCE_INCREMENT
      );

      // Update memory
      await pool.query(
        `UPDATE user_memories
         SET confidence = $1,
             frequency = $2,
             confirmation_count = $3,
             last_accessed_at = NOW(),
             updated_at = NOW()
         WHERE id = $4`,
        [newConfidence, current.frequency + 1, current.confirmation_count + 1, memoryId]
      );

      logger.debug(`Updated memory confirmation: ${memoryId}, new confidence: ${newConfidence}`);
    } catch (error) {
      logger.error('Failed to update memory confirmation', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Process memory candidates - handles duplicate detection and storage
   */
  async processMemoryCandidates(
    userId: string,
    guildId: string,
    candidates: MemoryCandidate[]
  ): Promise<void> {
    for (const candidate of candidates) {
      try {
        // Check for similar existing memories
        const similar = await this.findSimilarMemories(userId, guildId, candidate);

        if (similar.length > 0) {
          // Update existing memory instead of creating duplicate
          const existingMemory = similar[0]; // Use the most similar
          await this.updateMemoryConfirmation(existingMemory.id!);
          logger.debug(`Updated existing memory instead of creating duplicate: ${existingMemory.id}`);
        } else {
          // Create new memory
          await this.addMemory({
            userId,
            guildId,
            content: candidate.content,
            normalizedContent: candidate.normalizedContent,
            confidence: candidate.confidence,
            frequency: 1,
            confirmationCount: 1,
            type: candidate.type,
            source: candidate.source,
            firstObservedAt: new Date()
          });
        }
      } catch (error) {
        // Continue processing other candidates even if one fails
        logger.error('Failed to process memory candidate', {
          userId,
          candidate: candidate.content,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Calculate similarity between two normalized content strings
   */
  private calculateSimilarity(normalized1: string, normalized2: string): number {
    const words1 = normalized1.split(' ');
    const words2 = normalized2.split(' ');
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    if (union.size === 0) return 0;
    
    return intersection.size / union.size;
  }

  /**
   * Retrieve relevant memories for a user
   */
  async getRelevantMemories(userId: string, guildId: string): Promise<Memory[]> {
    try {
      const pool = getPool();
      const { rows } = await pool.query<UserMemoryRow>(
        `SELECT * FROM user_memories
         WHERE user_id = $1 AND guild_id = $2 AND is_active = true AND confidence >= $3
         ORDER BY confidence DESC, confirmation_count DESC
         LIMIT $4`,
        [userId, guildId, MEMORY_CONFIDENCE_THRESHOLD, MEMORY_RETRIEVAL_LIMIT]
      );

      // Update last accessed time for retrieved memories
      if (rows.length > 0) {
        const memoryIds = rows.map(m => m.id);
        await pool.query(
          `UPDATE user_memories SET last_accessed_at = NOW() WHERE id = ANY($1::uuid[])`,
          [memoryIds]
        );
      }

      return rows.map(row => this.mapDbMemoryToInterface(row));
    } catch (error) {
      logger.error('Failed to retrieve memories', {
        userId,
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Format memories for AI context
   */
  formatMemoriesForAI(memories: Memory[]): string {
    if (memories.length === 0) {
      return '';
    }

    return memories
      .map(m => `- ${m.content} (confidence: ${m.confidence}, mentioned ${m.frequency} times)`)
      .join('\n');
  }

  /**
   * Map database profile row to interface
   */
  private mapDbProfileToInterface(db: UserProfileRow): UserProfile {
    return {
      userId: db.user_id,
      guildId: db.guild_id,
      username: db.username || undefined,
      displayName: db.display_name || undefined,
      memoryEligible: db.memory_eligible,
      isExtra: db.is_extra,
      isFeaturedExtra: db.is_featured_extra,
      isSupportingCast: db.is_supporting_cast,
      lastInteractionAt: db.last_interaction_at ? new Date(db.last_interaction_at) : undefined
    };
  }

  /**
   * Map database memory row to interface
   */
  private mapDbMemoryToInterface(db: UserMemoryRow): Memory {
    const confidence = typeof db.confidence === 'string' ? parseFloat(db.confidence) : db.confidence;
    return {
      id: db.id,
      userId: db.user_id,
      guildId: db.guild_id,
      content: db.memory_content,
      normalizedContent: db.normalized_content ?? undefined,
      confidence,
      frequency: db.frequency,
      confirmationCount: db.confirmation_count || 1,
      type: (db.memory_type as MemoryType) || 'other',
      source: db.source,
      lastAccessedAt: db.last_accessed_at ? new Date(db.last_accessed_at) : undefined,
      firstObservedAt: db.first_observed_at ? new Date(db.first_observed_at) : undefined,
      createdAt: db.created_at ? new Date(db.created_at) : undefined,
      updatedAt: db.updated_at ? new Date(db.updated_at) : undefined,
      isActive: db.is_active !== undefined ? db.is_active : true
    };
  }
}

export const memoryService = new MemoryService();
