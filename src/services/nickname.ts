/**
 * Nickname service for Bocchi
 * Handles random nickname generation with uniqueness checking
 */

import { Guild, GuildMember } from 'discord.js';
import { logger } from '../utils/logger';
import {
  FIRST_WORDS,
  SECOND_WORDS,
  DISCORD_NICKNAME_MAX_LENGTH,
  NICKNAME_MAX_GENERATION_ATTEMPTS
} from '../config/nicknames';

export class NicknameService {
  constructor() {
    // No AI service needed - using random selection
  }

  /**
   * Generate a unique nickname for a member
   * Will retry until a unique nickname is found or max attempts reached
   * Uses cached nickname set to avoid repeated Discord API calls
   */
  async generateUniqueNickname(existingNicknames: Set<string>): Promise<string | null> {
    for (let attempt = 1; attempt <= NICKNAME_MAX_GENERATION_ATTEMPTS; attempt++) {
      const candidate = this.generateRandomNickname();
      
      if (!candidate) {
        logger.warn('Failed to generate random nickname');
        continue;
      }

      // Truncate to Discord's limit if needed
      const truncated = this.truncateToDiscordLimit(candidate);
      
      // Check if nickname is already taken (case-insensitive)
      if (!this.isNicknameTaken(truncated, existingNicknames)) {
        logger.info('Generated unique nickname', { 
          nickname: truncated, 
          attempt 
        });
        return truncated;
      }

      logger.debug('Nickname already taken, retrying', { 
        nickname: truncated, 
        attempt 
      });
    }

    logger.error('Failed to generate unique nickname after all attempts');
    return null;
  }

  /**
   * Generate a random nickname by combining two words
   * Simple deterministic approach: first + second
   */
  private generateRandomNickname(): string {
    const first = FIRST_WORDS[Math.floor(Math.random() * FIRST_WORDS.length)];
    const second = SECOND_WORDS[Math.floor(Math.random() * SECOND_WORDS.length)];
    return `${first} ${second}`;
  }

  /**
   * Check if a nickname is already taken (case-insensitive)
   */
  private isNicknameTaken(nickname: string, existingNicknames: Set<string>): boolean {
    const normalized = nickname.toLowerCase();
    return existingNicknames.has(normalized);
  }

  /**
   * Build a Set of all current nicknames in a guild (case-insensitive)
   * This should be called once and cached for bulk operations
   */
  async buildNicknameSet(guild: Guild): Promise<Set<string>> {
    try {
      const members = await guild.members.fetch();
      const nicknameSet = new Set<string>();

      members.forEach(member => {
        if (member.nickname) {
          nicknameSet.add(member.nickname.toLowerCase());
        }
      });

      return nicknameSet;
    } catch (error) {
      logger.error('Failed to build nickname set', {
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return new Set<string>();
    }
  }

  /**
   * Truncate nickname to Discord's character limit
   */
  private truncateToDiscordLimit(nickname: string): string {
    if (nickname.length <= DISCORD_NICKNAME_MAX_LENGTH) {
      return nickname;
    }
    
    // Try to truncate at a word boundary
    const truncated = nickname.substring(0, DISCORD_NICKNAME_MAX_LENGTH - 3).trim();
    return truncated + '...';
  }

  /**
   * Assign a nickname to a guild member
   * Returns success status and error reason if failed
   */
  async assignNickname(member: GuildMember, nickname: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure nickname is within Discord's limits
      const truncated = this.truncateToDiscordLimit(nickname);
      
      await member.setNickname(truncated);
      
      logger.info('Nickname assigned successfully', {
        userId: member.id,
        username: member.user.tag,
        nickname: truncated
      });
      
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check for specific Discord permission errors
      if (errorMessage.includes('Missing Permissions') || errorMessage.includes('Missing Access')) {
        logger.warn('Cannot assign nickname due to role hierarchy', {
          userId: member.id,
          username: member.user.tag,
          nickname,
          error: errorMessage
        });
        return { success: false, error: 'role_hierarchy' };
      }
      
      logger.error('Failed to assign nickname', {
        userId: member.id,
        username: member.user.tag,
        nickname,
        error: errorMessage
      });
 return { success: false, error: 'unknown' };
    }
  }

  /**
   * Remove a member's server nickname
   * Returns success status and error reason if failed
   */
  async removeNickname(member: GuildMember): Promise<{ success: boolean; error?: string }> {
    try {
      await member.setNickname(null);
      
      logger.info('Nickname removed successfully', {
        userId: member.id,
        username: member.user.tag
      });
      
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check for specific Discord permission errors
      if (errorMessage.includes('Missing Permissions') || errorMessage.includes('Missing Access')) {
        logger.warn('Cannot remove nickname due to role hierarchy', {
          userId: member.id,
          username: member.user.tag,
          error: errorMessage
        });
        return { success: false, error: 'role_hierarchy' };
      }
      
      logger.error('Failed to remove nickname', {
        userId: member.id,
        username: member.user.tag,
        error: errorMessage
      });
      return { success: false, error: 'unknown' };
    }
  }

  /**
   * Check if a member already has a server nickname
   */
  hasNickname(member: GuildMember): boolean {
    return member.nickname !== null;
  }

  /**
   * Generate and assign a nickname to a member (full flow)
   * This is a convenience method that builds the nickname set internally
   * For bulk operations, use the cached nickname set pattern instead
   */
  async generateAndAssignNickname(member: GuildMember): Promise<{ success: boolean; error?: string }> {
    if (!member.guild) {
      logger.warn('Member has no guild, cannot assign nickname');
      return { success: false, error: 'no_guild' };
    }

    const nicknameSet = await this.buildNicknameSet(member.guild);
    const nickname = await this.generateUniqueNickname(nicknameSet);
    
    if (!nickname) {
      logger.warn('Failed to generate unique nickname for member', {
        userId: member.id,
        username: member.user.tag
      });
      return { success: false, error: 'generation_failed' };
    }

    return await this.assignNickname(member, nickname);
  }
}

// Singleton instance will be initialized in messageRouter
let nicknameService: NicknameService | null = null;

export function initNicknameService(): void {
  nicknameService = new NicknameService();
}

export function getNicknameService(): NicknameService {
  if (!nicknameService) {
    throw new Error('NicknameService not initialized. Call initNicknameService first.');
  }
  return nicknameService;
}
