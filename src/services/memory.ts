/**
 * Memory service for Bot Kun v2
 * Handles user profiles and long-term memory operations with Supabase
 */

import { getSupabaseClient } from '../database/supabase';
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
      const supabase = getSupabaseClient();
      
      // Try to get existing profile
      const { data: existingProfile, error: fetchError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (existingProfile) {
        // Update profile if user info changed
        if (username || displayName) {
          const { error: updateError } = await supabase
            .from('user_profiles')
            .update({
              username: username || existingProfile.username,
              display_name: displayName || existingProfile.display_name,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('guild_id', guildId);

          if (updateError) {
            logger.warn('Failed to update user profile', { error: updateError.message });
          }
        }

        return this.mapDbProfileToInterface(existingProfile);
      }

      // Create new profile
      const { data: newProfile, error: createError } = await supabase
        .from('user_profiles')
        .insert({
          user_id: userId,
          guild_id: guildId,
          username: username || null,
          display_name: displayName || null,
          memory_eligible: false,
          is_extra: false,
          is_featured_extra: false,
          is_supporting_cast: false
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      logger.debug(`Created new profile for user ${userId} in guild ${guildId}`);
      return this.mapDbProfileToInterface(newProfile);
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

      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('user_profiles')
        .update({
          memory_eligible: isEligible,
          is_extra: isExtra,
          is_featured_extra: isFeaturedExtra,
          is_supporting_cast: isSupportingCast,
          extra_role_id: isEligible ? member.roles.cache.find((_r: any) => 
            [isExtra, isFeaturedExtra, isSupportingCast].includes(true)
          )?.id : null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('guild_id', guildId);

      if (error) {
        throw error;
      }

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
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('user_profiles')
        .update({
          last_interaction_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('guild_id', guildId);

      if (error) {
        throw error;
      }
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
      const supabase = getSupabaseClient();
      
      // Count eligible users with recent interactions
      const { count, error } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .eq('memory_eligible', true)
        .gt('last_interaction_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // 30 days

      if (error) {
        throw error;
      }

      // If under cap, user is automatically in pool
      if (!count || count < MEMORY_ACTIVE_MEMBER_CAP) {
        return true;
      }

      // Check if user is in top N by last interaction
      const { data: topUsers, error: rankError } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('guild_id', guildId)
        .eq('memory_eligible', true)
        .gt('last_interaction_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('last_interaction_at', { ascending: false })
        .limit(MEMORY_ACTIVE_MEMBER_CAP);

      if (rankError) {
        throw rankError;
      }

      return topUsers?.some(u => u.user_id === userId) ?? false;
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
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('user_memories')
        .insert({
          user_id: memory.userId,
          guild_id: memory.guildId,
          memory_content: memory.content,
          normalized_content: memory.normalizedContent,
          confidence: memory.confidence,
          frequency: memory.frequency,
          confirmation_count: memory.confirmationCount,
          memory_type: memory.type,
          source: memory.source,
          last_accessed_at: new Date().toISOString(),
          first_observed_at: memory.firstObservedAt || new Date().toISOString(),
          is_active: memory.isActive !== undefined ? memory.isActive : true
        })
        .select('id')
        .single();

      if (error) {
        throw error;
      }

      logger.debug(`Added memory for user ${memory.userId}: ${memory.content.substring(0, 50)}...`);
      return data.id;
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
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('user_memories')
        .select('*')
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .eq('memory_type', candidate.type)
        .eq('is_active', true)
        .limit(20); // Check recent memories for similarity

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return [];
      }

      // Calculate similarity and filter
      const similar = data
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
      const supabase = getSupabaseClient();
      
      // Get current memory
      const { data: current, error: fetchError } = await supabase
        .from('user_memories')
        .select('*')
        .eq('id', memoryId)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      // Calculate new confidence (capped at max)
      const newConfidence = Math.min(
        MEMORY_MAX_CONFIDENCE,
        current.confidence + MEMORY_CONFIDENCE_INCREMENT
      );

      // Update memory
      const { error: updateError } = await supabase
        .from('user_memories')
        .update({
          confidence: newConfidence,
          frequency: current.frequency + 1,
          confirmation_count: current.confirmation_count + 1,
          last_accessed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', memoryId);

      if (updateError) {
        throw updateError;
      }

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
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('user_memories')
        .select('*')
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .eq('is_active', true)
        .gte('confidence', MEMORY_CONFIDENCE_THRESHOLD)
        .order('confidence', { ascending: false })
        .order('confirmation_count', { ascending: false })
        .limit(MEMORY_RETRIEVAL_LIMIT);

      if (error) {
        throw error;
      }

      // Update last accessed time for retrieved memories
      if (data && data.length > 0) {
        const memoryIds = data.map(m => m.id);
        await supabase
          .from('user_memories')
          .update({ last_accessed_at: new Date().toISOString() })
          .in('id', memoryIds);
      }

      return data?.map(this.mapDbMemoryToInterface) ?? [];
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
   * Map database profile to interface
   */
  private mapDbProfileToInterface(db: any): UserProfile {
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
   * Map database memory to interface
   */
  private mapDbMemoryToInterface(db: any): Memory {
    return {
      id: db.id,
      userId: db.user_id,
      guildId: db.guild_id,
      content: db.memory_content,
      normalizedContent: db.normalized_content,
      confidence: db.confidence,
      frequency: db.frequency,
      confirmationCount: db.confirmation_count || 1,
      type: db.memory_type || 'other',
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
