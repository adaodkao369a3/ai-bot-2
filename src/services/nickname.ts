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
   */
  async generateUniqueNickname(guild: Guild, excludeUserIds: string[] = []): Promise<string | null> {
    const existingNicknames = await this.getExistingNicknames(guild);
    
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
   */
  private async generateNicknameCandidate(): Promise<string | null> {
    const wordBankContext = this.buildWordBankContext();
    
    const prompt = `You are a nickname generator for a Discord bot. Generate ONE short, funny Discord nickname inspired by current internet culture.

The nickname should be:
- Weird, absurd, stupid, edgy, or occasionally nonsensical
- Meme-heavy and reference current internet culture
- The kind of name that makes people go "what the fuck is that name"
- NOT sanitized corporate names like "Friendly Gamer"
- Short enough for Discord's 32-character limit

You can use, combine, mutate, mash, or ignore these word banks as inspiration:

${wordBankContext}

Examples of the style:
- Dumguru
- Gojo's Accountant
- Chief Yapper
- Captain Dih
- Bocchi's Tax Auditor
- Doomscroll Sensei
- Lord Braincell
- Yap Titan
- Professor Bonk
- Dumbfessor
- Netflix Final Boss

Generate ONLY the nickname, nothing else. No quotes, no explanation, just the nickname text.`;

    try {
      const response = await this.aiService.generateResponse({
        systemPrompt: 'You are a creative nickname generator. Generate exactly one nickname per request.',
        userMessage: prompt,
        userName: 'nickname-generator'
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
   * Get all current nicknames in a guild
   */
  private async getExistingNicknames(guild: Guild): Promise<string[]> {
    try {
      const members = await guild.members.fetch();
      const nicknames: string[] = [];

      members.forEach(member => {
        if (member.nickname) {
          nicknames.push(member.nickname.toLowerCase());
        }
      });

      return nicknames;
    } catch (error) {
      logger.error('Failed to fetch existing nicknames', {
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Check if a nickname is already taken (case-insensitive)
   */
  private isNicknameTaken(nickname: string, existingNicknames: string[]): boolean {
    const normalized = nickname.toLowerCase();
    return existingNicknames.includes(normalized);
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
   */
  async assignNickname(member: GuildMember, nickname: string): Promise<boolean> {
    try {
      // Ensure nickname is within Discord's limits
      const truncated = this.truncateToDiscordLimit(nickname);
      
      await member.setNickname(truncated);
      
      logger.info('Nickname assigned successfully', {
        userId: member.id,
        username: member.user.tag,
        nickname: truncated
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to assign nickname', {
        userId: member.id,
        username: member.user.tag,
        nickname,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
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
   */
  async generateAndAssignNickname(member: GuildMember): Promise<boolean> {
    if (!member.guild) {
      logger.warn('Member has no guild, cannot assign nickname');
      return false;
    }

    const nickname = await this.generateUniqueNickname(member.guild);
    
    if (!nickname) {
      logger.warn('Failed to generate unique nickname for member', {
        userId: member.id,
        username: member.user.tag
      });
      return false;
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
