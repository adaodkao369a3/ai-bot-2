/**
 * Nickname service for Bocchi
 * Handles AI-powered nickname generation with uniqueness checking
 */

import { Guild, GuildMember } from 'discord.js';
import { AIService } from './ai';
import { logger } from '../utils/logger';
import {
  FIRST_WORDS,
  SECOND_WORDS,
  NICKNAME_TITLES,
  NICKNAME_ADJECTIVES,
  NICKNAME_NOUNS,
  DISCORD_NICKNAME_MAX_LENGTH,
  NICKNAME_MAX_GENERATION_ATTEMPTS
} from '../config/nicknames';

export class NicknameService {
  private aiService: AIService;

  constructor(aiService: AIService) {
    this.aiService = aiService;
  }

  /**
   * Generate a unique nickname for a member
   * Will retry until a unique nickname is found or max attempts reached
   * Uses cached nickname set to avoid repeated Discord API calls
   */
  async generateUniqueNickname(existingNicknames: Set<string>): Promise<string | null> {
    for (let attempt = 1; attempt <= NICKNAME_MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        const candidate = await this.generateNicknameCandidate();
        
        if (!candidate) {
          logger.warn('AI returned empty nickname candidate');
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
      } catch (error) {
        logger.warn('Nickname generation attempt failed', {
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.error('Failed to generate unique nickname after all attempts');
    return null;
  }

  /**
   * Generate a single nickname candidate using AI
   * Uses a small, dedicated request with low token limits
   */
  private async generateNicknameCandidate(): Promise<string | null> {
    const wordBankContext = this.buildWordBankContext();
    
    const prompt = `Generate ONE short, funny Discord nickname.

Style: modern Discord/internet brainrot, memes, anime, gaming slang, viral phrases, absurd titles, stupid wordplay.

Use these word banks as building blocks:
${wordBankContext}

Examples: Captain Dih, Chief Yapper, Dumguru, Gojo's Accountant, Doomscroll Sensei, Bocchi's Tax Auditor, Lord Braincell, Yap Titan, Netflix Final Boss.

Output ONLY the nickname. No quotes, no explanation. Max 32 characters.`;

    try {
      const response = await this.aiService.generateResponse({
        systemPrompt: 'Generate exactly one short Discord nickname per request.',
        userMessage: prompt,
        userName: 'nickname-generator',
        maxTokens: 50 // Very low limit since we only need one short nickname
      });

      if (response.success && response.content) {
        // Clean up the response - remove quotes, extra whitespace, etc.
        const cleaned = response.content
          .trim()
          .replace(/^["']|["']$/g, '') // Remove surrounding quotes
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();

        return cleaned || null;
      }

      return null;
    } catch (error) {
      logger.error('AI nickname generation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Build word bank context for the AI prompt
   */
  private buildWordBankContext(): string {
    const sampleSize = 20; // Don't overwhelm the AI with all words
    
    const firstWordsSample = this.sampleArray(FIRST_WORDS, sampleSize);
    const secondWordsSample = this.sampleArray(SECOND_WORDS, sampleSize);
    const titlesSample = this.sampleArray(NICKNAME_TITLES, sampleSize);
    const adjectivesSample = this.sampleArray(NICKNAME_ADJECTIVES, sampleSize);
    const nounsSample = this.sampleArray(NICKNAME_NOUNS, sampleSize);

    return `FIRST_WORDS (titles/ranks): ${firstWordsSample.join(', ')}
SECOND_WORDS (absurd words): ${secondWordsSample.join(', ')}
TITLES (honorifics): ${titlesSample.join(', ')}
ADJECTIVES: ${adjectivesSample.join(', ')}
NOUNS: ${nounsSample.join(', ')}

You can combine these like: Captain + Dih, Chief + Yapper, Professor + Bonk, Lord + Braincell`;
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
   * Sample random elements from an array
   */
  private sampleArray<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
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

export function initNicknameService(aiService: AIService): void {
  nicknameService = new NicknameService(aiService);
}

export function getNicknameService(): NicknameService {
  if (!nicknameService) {
    throw new Error('NicknameService not initialized. Call initNicknameService first.');
  }
  return nicknameService;
}
