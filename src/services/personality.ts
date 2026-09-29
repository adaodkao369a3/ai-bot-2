/**
 * Bocchi personality foundation
 * Now delegates to the personality manager for character-specific responses
 */

import { getPersonalityManager } from './personalityManager';
import { EmojiKey } from '../config/characters';

export class PersonalityService {
  /**
   * Get the base system prompt for the active character in a guild
   */
  async getSystemPrompt(guildId: string): Promise<string> {
    const manager = getPersonalityManager();
    return await manager.getSystemPrompt(guildId);
  }

  /**
   * Get cooldown message for rate limiting (character-specific)
   */
  async getCooldownMessage(guildId: string, resetTimestamp: number): Promise<string> {
    const manager = getPersonalityManager();
    return await manager.getCooldownMessage(guildId, resetTimestamp);
  }

  /**
   * Get bot disabled message (character-specific)
   */
  async getDisabledMessage(guildId: string): Promise<string> {
    const manager = getPersonalityManager();
    return await manager.getDisabledMessage(guildId);
  }

  /**
   * Get blacklisted message (character-specific)
   */
  async getBlacklistedMessage(guildId: string): Promise<string> {
    const manager = getPersonalityManager();
    return await manager.getBlacklistedMessage(guildId);
  }

  /**
   * Get error message for AI failures (character-specific)
   */
  async getErrorMessage(guildId: string): Promise<string> {
    const manager = getPersonalityManager();
    return await manager.getErrorMessage(guildId);
  }

  /**
   * Get a random emoji for the active character (character-specific)
   */
  async getRandomEmoji(guildId: string, key: EmojiKey): Promise<string | null> {
    const manager = getPersonalityManager();
    return await manager.getRandomEmoji(guildId, key);
  }
}

export const personalityService = new PersonalityService();