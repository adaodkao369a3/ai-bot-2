/**
 * Personality management service for Bocchi
 * Handles personality selection, database persistence, and character application
 */

import { getPool } from '../database/pool';
import { logger } from '../utils/logger';
import { Character, getCharacter, characterExists, EmojiKey, getRandomEmoji } from '../config/characters';
import { Client, Guild } from 'discord.js';
import fs from 'fs';
import path from 'path';

interface PersonalitySelectionRow {
  guild_id: string;
  personality_id: string;
  selected_avatar_filename: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Personality management service
 * Handles database persistence and character application
 */
export class PersonalityManager {
  private currentPersonalities: Map<string, string> = new Map(); // guild_id -> personality_id
  private selectedAvatars: Map<string, string | null> = new Map(); // guild_id -> avatar_filename
  private usedAvatars: Map<string, Set<string>> = new Map(); // guild_id -> set of used avatar filenames
  private initialized = false;

  /**
   * Initialize the personality manager
   * Load active personalities from database and apply them
   */
  async initialize(client: Client): Promise<void> {
    if (this.initialized) {
      logger.debug('Personality manager already initialized');
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<PersonalitySelectionRow>(
        `SELECT guild_id, personality_id, selected_avatar_filename FROM personality_selection`
      );

      // Load personalities into memory
      for (const row of rows) {
        this.currentPersonalities.set(row.guild_id, row.personality_id);
        this.selectedAvatars.set(row.guild_id, row.selected_avatar_filename);
        this.usedAvatars.set(row.guild_id, new Set()); // Initialize empty set for each guild

        // Apply personality to guild if client is ready
        if (client && client.isReady()) {
          try {
            const guild = await client.guilds.fetch(row.guild_id);
            await this.applyPersonalityToGuild(guild, row.personality_id, row.selected_avatar_filename);
          } catch (error) {
            logger.warn('Failed to apply personality to guild during initialization', {
              guildId: row.guild_id,
              personalityId: row.personality_id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      this.initialized = true;
      logger.info(`Personality manager initialized with ${this.currentPersonalities.size} guild(s)`);
    } catch (error) {
      logger.error('Failed to initialize personality manager', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - allow bot to start even if personality initialization fails
      this.initialized = true;
    }
  }

  /**
   * Get the active personality ID for a guild
   * Returns default personality if none is set
   */
  async getActivePersonalityId(guildId: string): Promise<string> {
    // Check cache first
    if (this.currentPersonalities.has(guildId)) {
      return this.currentPersonalities.get(guildId)!;
    }

    // Check database
    try {
      const pool = getPool();
      const { rows } = await pool.query<PersonalitySelectionRow>(
        `SELECT personality_id FROM personality_selection WHERE guild_id = $1 LIMIT 1`,
        [guildId]
      );

      if (rows.length > 0) {
        const personalityId = rows[0].personality_id;
        this.currentPersonalities.set(guildId, personalityId);
        return personalityId;
      }
    } catch (error) {
      logger.error('Failed to fetch active personality from database', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Return default personality (bocchi_thug as current default)
    return 'bocchi_thug';
  }

  /**
   * Get the active character for a guild
   */
  async getActiveCharacter(guildId: string): Promise<Character> {
    const personalityId = await this.getActivePersonalityId(guildId);
    const character = getCharacter(personalityId);

    if (!character) {
      logger.warn(`Character not found for personality ID: ${personalityId}, falling back to bocchi_thug`);
      return getCharacter('bocchi_thug')!;
    }

    return character;
  }

  /**
   * Set the active personality for a guild
   */
  async setPersonality(guildId: string, personalityId: string, client: Client): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate personality ID exists
      if (!characterExists(personalityId)) {
        return { success: false, error: 'Invalid personality ID' };
      }

      const pool = getPool();

      // Upsert into database
      await pool.query(
        `INSERT INTO personality_selection (guild_id, personality_id, selected_avatar_filename)
         VALUES ($1, $2, NULL)
         ON CONFLICT (guild_id)
         DO UPDATE SET personality_id = EXCLUDED.personality_id, selected_avatar_filename = NULL, updated_at = NOW()`,
        [guildId, personalityId]
      );

      // Update cache
      this.currentPersonalities.set(guildId, personalityId);
      this.selectedAvatars.set(guildId, null);
      this.usedAvatars.set(guildId, new Set()); // Reset used avatars when personality changes

      // Apply personality to guild
      if (client.isReady()) {
        const guild = await client.guilds.fetch(guildId);
        await this.applyPersonalityToGuild(guild, personalityId, null);
      }

      logger.info(`Personality set to ${personalityId} for guild ${guildId}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set personality', {
        guildId,
        personalityId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: 'Failed to set personality' };
    }
  }

  /**
   * Apply personality to a guild (nickname and avatar)
   */
  private async applyPersonalityToGuild(guild: Guild, personalityId: string, avatarFilename: string | null): Promise<void> {
    const character = getCharacter(personalityId);
    if (!character) {
      logger.warn(`Cannot apply personality: character not found for ID ${personalityId}`);
      return;
    }

    // Apply nickname if configured
    if (character.nickname) {
      try {
        const botMember = await guild.members.fetchMe();
        if (botMember) {
          await botMember.setNickname(character.nickname);
          logger.info(`Nickname set to "${character.nickname}" for guild ${guild.id}`);
        }
      } catch (error) {
        logger.warn('Failed to set bot nickname', {
          guildId: guild.id,
          nickname: character.nickname,
          error: error instanceof Error ? error.message : String(error)
        });
        // Don't fail the personality switch if nickname fails
      }
    }

    // Apply avatar if assets are available
    if (character.avatarAssets.length > 0) {
      try {
        let selectedAvatar: string;

        if (avatarFilename) {
          // Use the provided avatar
          selectedAvatar = avatarFilename;
        } else {
          // Pick a random avatar that hasn't been used yet
          const guildUsedAvatars = this.usedAvatars.get(guild.id) || new Set();
          const availableAvatars = character.avatarAssets.filter(avatar => !guildUsedAvatars.has(avatar));

          if (availableAvatars.length === 0) {
            // All avatars have been used, reset and pick randomly
            guildUsedAvatars.clear();
            selectedAvatar = character.avatarAssets[Math.floor(Math.random() * character.avatarAssets.length)];
          } else {
            // Pick from available avatars
            selectedAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
          }

          // Mark this avatar as used
          guildUsedAvatars.add(selectedAvatar);
          this.usedAvatars.set(guild.id, guildUsedAvatars);
        }

        const avatarPath = path.join(process.cwd(), 'assets', 'avatars', selectedAvatar);

        // Check if file exists
        if (fs.existsSync(avatarPath)) {
          const avatarBuffer = fs.readFileSync(avatarPath);
          await guild.client.user?.setAvatar(avatarBuffer);
          logger.info(`Avatar set to ${selectedAvatar} for guild ${guild.id}`);

          // Save the selected avatar to database
          if (avatarFilename !== selectedAvatar) {
            const pool = getPool();
            await pool.query(
              `UPDATE personality_selection SET selected_avatar_filename = $1 WHERE guild_id = $2`,
              [selectedAvatar, guild.id]
            );
            this.selectedAvatars.set(guild.id, selectedAvatar);
          }
        } else {
          logger.warn(`Avatar file not found: ${avatarPath}, skipping avatar change`);
        }
      } catch (error) {
        logger.warn('Failed to set bot avatar', {
          guildId: guild.id,
          error: error instanceof Error ? error.message : String(error)
        });
        // Don't fail the personality switch if avatar fails
      }
    }
  }

  /**
   * Get a random emoji for the active character in a guild
   */
  async getRandomEmoji(guildId: string, key: EmojiKey): Promise<string | null> {
    const character = await this.getActiveCharacter(guildId);
    return getRandomEmoji(character.id, key);
  }

  /**
   * Get cooldown message for the active character in a guild
   */
  async getCooldownMessage(guildId: string, resetTimestamp: number): Promise<string> {
    const character = await this.getActiveCharacter(guildId);
    const messageFunc = character.cooldownMessages[Math.floor(Math.random() * character.cooldownMessages.length)];
    return messageFunc(resetTimestamp);
  }

  /**
   * Get disabled message for the active character in a guild
   */
  async getDisabledMessage(guildId: string): Promise<string> {
    const character = await this.getActiveCharacter(guildId);
    return character.disabledMessages[Math.floor(Math.random() * character.disabledMessages.length)];
  }

  /**
   * Get blacklisted message for the active character in a guild
   */
  async getBlacklistedMessage(guildId: string): Promise<string> {
    const character = await this.getActiveCharacter(guildId);
    return character.blacklistedMessages[Math.floor(Math.random() * character.blacklistedMessages.length)];
  }

  /**
   * Get error message for the active character in a guild
   */
  async getErrorMessage(guildId: string): Promise<string> {
    const character = await this.getActiveCharacter(guildId);
    return character.errorMessages[Math.floor(Math.random() * character.errorMessages.length)];
  }

  /**
   * Get system prompt for the active character in a guild
   */
  async getSystemPrompt(guildId: string): Promise<string> {
    const character = await this.getActiveCharacter(guildId);
    return character.systemPrompt;
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.currentPersonalities.clear();
    this.selectedAvatars.clear();
    this.usedAvatars.clear();
    this.initialized = false;
    logger.debug('Personality manager cache cleared');
  }

  /**
   * Rotate to the next random avatar for the current personality
   */
  async rotateAvatar(guildId: string, client: Client): Promise<{ success: boolean; error?: string }> {
    try {
      const personalityId = await this.getActivePersonalityId(guildId);
      const character = getCharacter(personalityId);

      if (!character) {
        return { success: false, error: 'Character not found' };
      }

      if (character.avatarAssets.length === 0) {
        return { success: false, error: 'No avatars available for this personality' };
      }

      // Apply personality with null avatar to trigger random selection
      if (client.isReady()) {
        const guild = await client.guilds.fetch(guildId);
        await this.applyPersonalityToGuild(guild, personalityId, null);
      }

      logger.info(`Avatar rotated for guild ${guildId}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to rotate avatar', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: 'Failed to rotate avatar' };
    }
  }
}

// Singleton instance
let personalityManager: PersonalityManager | null = null;

export function initPersonalityManager(client: Client): PersonalityManager {
  if (!personalityManager) {
    personalityManager = new PersonalityManager();
  }
  return personalityManager;
}

export function getPersonalityManager(): PersonalityManager {
  if (!personalityManager) {
    throw new Error('PersonalityManager not initialized. Call initPersonalityManager first.');
  }
  return personalityManager;
}