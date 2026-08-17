/**
 * Addressing detection service for Bot Kun v2
 * Detects when messages are directed at Bot Kun via mentions, name, or replies
 */

import { Message } from 'discord.js';
import { BOT_NAME } from '../config';
import { logger } from '../utils/logger';

export class AddressingService {
  /**
   * Check if a message is addressing Bot Kun
   */
  async isAddressingBot(message: Message, botUserId: string): Promise<boolean> {
    return (
      this.isMention(message, botUserId) ||
      this.isNameAddress(message, botUserId) ||
      await this.isReplyToBot(message, botUserId)
    );
  }

  /**
   * Check if message mentions Bot Kun
   */
  isMention(message: Message, botUserId: string): boolean {
    return message.mentions.users.has(botUserId);
  }

  /**
   * Check if message uses Bot Kun's name
   */
  isNameAddress(message: Message, _botUserId: string): boolean {
    const content = message.content.toLowerCase();
    const botNameVariations = [
      BOT_NAME,
      'bot kun',
      'bot-kun',
      'botkun'
    ];

    // Check if message starts with bot name variations (with space or punctuation)
    const startsWithName = botNameVariations.some(name => 
      content.startsWith(name + ' ') || content.startsWith(name + ',') || content.startsWith(name + '!') || content.startsWith(name + '?')
    );

    // Check if message contains bot name with word boundaries
    const containsName = botNameVariations.some(name => {
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      return regex.test(content);
    });

    return startsWithName || containsName;
  }

  /**
   * Check if message is a reply to Bot Kun
   * This fetches the referenced message to verify it's from Bot Kun
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
   * Extract the actual message content without Bot Kun's name/mention
   */
  extractContent(message: Message, botUserId: string): string {
    let content = message.content;

    // Remove bot mention (specific to this bot user ID)
    if (this.isMention(message, botUserId)) {
      const mentionRegex = new RegExp(`<@!?${botUserId}>`, 'g');
      content = content.replace(mentionRegex, '').trim();
    }

    // Remove bot name variations at the start
    const botNameVariations = [
      BOT_NAME,
      'bot kun',
      'bot-kun',
      'botkun'
    ];

    for (const name of botNameVariations) {
      const regex = new RegExp(`^${name}[\\s,!?]*`, 'i');
      content = content.replace(regex, '').trim();
    }

    return content;
  }
}

export const addressingService = new AddressingService();
