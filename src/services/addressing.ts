/**
 * Addressing detection service for Bocchi
 * Detects when messages are directed at Bocchi via mentions, name, or replies
 */

import { Message } from 'discord.js';
import { BOT_NAME } from '../config';
import { logger } from '../utils/logger';
import { getPersonalityManager } from './personalityManager';

export class AddressingService {
  /**
   * Check if a message is addressing Bocchi
   */
  async isAddressingBot(message: Message, botUserId: string, guildId: string): Promise<boolean> {
    return (
      this.isMention(message, botUserId) ||
      await this.isNameAddress(message, guildId) ||
      await this.isReplyToBot(message, botUserId)
    );
  }

  /**
   * Check if message mentions Bocchi
   */
  isMention(message: Message, botUserId: string): boolean {
    return message.mentions.users.has(botUserId);
  }

  /**
   * Check if message uses the active character's invocation names
   */
  async isNameAddress(message: Message, guildId: string): Promise<boolean> {
    const content = message.content.toLowerCase();
    
    try {
      const personalityManager = getPersonalityManager();
      const character = await personalityManager.getActiveCharacter(guildId);
      const invocationNames = character.invocationNames || [];

      if (invocationNames.length === 0) {
        // Fallback to legacy BOT_NAME if no invocation names configured
        return this.matchesLegacyName(content);
      }

      // Common greetings that might precede the name
      const greetings = ['hi', 'hey', 'hello', 'yo', 'sup', 'ay', 'ayy', 'oi'];
      
      // Check if message starts with invocation name (with space or punctuation)
      const startsWithName = invocationNames.some(name => {
        const lowerName = name.toLowerCase();
        return content.startsWith(lowerName + ' ') || 
               content.startsWith(lowerName + ',') || 
               content.startsWith(lowerName + '!') || 
               content.startsWith(lowerName + '?') ||
               content === lowerName;
      });

      // Check if message starts with greeting followed by invocation name
      const greetingThenName = invocationNames.some(name => {
        const lowerName = name.toLowerCase();
        return greetings.some(greeting => {
          const pattern = `^${greeting}\\s*${lowerName}[\\s,!?]*`;
          const regex = new RegExp(pattern, 'i');
          return regex.test(content);
        });
      });

      // Check if message contains invocation name with word boundaries
      // but only at the beginning or after a short greeting to avoid false positives
      const containsNameEarly = invocationNames.some(name => {
        const lowerName = name.toLowerCase();
        // Match name at start or after greeting, with word boundaries
        const pattern = `^(?:${greetings.join('|')})?\\s*\\b${lowerName}\\b`;
        const regex = new RegExp(pattern, 'i');
        return regex.test(content);
      });

      return startsWithName || greetingThenName || containsNameEarly;
    } catch (error) {
      logger.error('Failed to get active character for name address check', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Fallback to legacy name matching on error
      return this.matchesLegacyName(content);
    }
  }

  /**
   * Legacy name matching fallback (for backwards compatibility)
   */
  private matchesLegacyName(content: string): boolean {
    const botNameVariations = [
      BOT_NAME,
      'bocchi chan',
      'bocchi-chan',
      'hitori',
      'hitori gotoh',
      'gotoh hitori'
    ];

    // Check if message starts with bot name variations (with space or punctuation)
    const startsWithName = botNameVariations.some(name => 
      content.startsWith(name + ' ') || content.startsWith(name + ',') || content.startsWith(name + '!') || content.startsWith(name + '?')
    );

    // Check if message contains bot name with word boundaries
    // Sort by length (longest first) to handle compound names properly
    const sortedVariations = [...botNameVariations].sort((a, b) => b.length - a.length);
    const containsName = sortedVariations.some(name => {
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      return regex.test(content);
    });

    return startsWithName || containsName;
  }

  /**
   * Check if message is a reply to Bocchi
   * This fetches the referenced message to verify it's from Bocchi
   */
  async isReplyToBot(message: Message, botUserId: string): Promise<boolean> {
    if (!message.reference) {
      return false;
    }

    try {
      const referencedMessage = await message.fetchReference();
      return referencedMessage.author.id === botUserId;
    } catch (error) {
      logger.error('Failed to fetch referenced message', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Extract the actual message content without bot's name/mention
   */
  async extractContent(message: Message, botUserId: string, guildId: string): Promise<string> {
    let content = message.content;

    // Remove bot mention (specific to this bot user ID)
    if (this.isMention(message, botUserId)) {
      const mentionRegex = new RegExp(`<@!?${botUserId}>`, 'g');
      content = content.replace(mentionRegex, '').trim();
    }

    // Remove active character's invocation names at the start
    try {
      const personalityManager = getPersonalityManager();
      const character = await personalityManager.getActiveCharacter(guildId);
      const invocationNames = character.invocationNames || [];

      if (invocationNames.length > 0) {
        const greetings = ['hi', 'hey', 'hello', 'yo', 'sup', 'ay', 'ayy', 'oi'];
        
        // Sort by length (longest first) to handle compound names properly
        const sortedNames = [...invocationNames].sort((a, b) => b.length - a.length);
        
        for (const name of sortedNames) {
          const lowerName = name.toLowerCase();
          
          // Remove name at start with punctuation
          let regex = new RegExp(`^${lowerName}[\\s,!?]*`, 'i');
          content = content.replace(regex, '').trim();
          
          // Remove greeting + name pattern
          for (const greeting of greetings) {
            regex = new RegExp(`^${greeting}\\s*${lowerName}[\\s,!?]*`, 'i');
            content = content.replace(regex, '').trim();
          }
        }
      } else {
        // Fallback to legacy name removal
        content = this.removeLegacyNames(content);
      }
    } catch (error) {
      logger.error('Failed to get active character for content extraction', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Fallback to legacy name removal on error
      content = this.removeLegacyNames(content);
    }

    return content;
  }

  /**
   * Legacy name removal fallback
   */
  private removeLegacyNames(content: string): string {
    const botNameVariations = [
      BOT_NAME,
      'bocchi chan',
      'bocchi-chan',
      'hitori',
      'hitori gotoh',
      'gotoh hitori'
    ];

    // Sort by length (longest first) to handle compound names properly
    botNameVariations.sort((a, b) => b.length - a.length);

    for (const name of botNameVariations) {
      const regex = new RegExp(`^${name}[\\s,!?]*`, 'i');
      content = content.replace(regex, '').trim();
    }

    return content;
  }
}

export const addressingService = new AddressingService();
