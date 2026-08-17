/**
 * Message routing pipeline for Bot Kun v2
 * Central message handling pipeline that coordinates all services
 */

import { Message, GuildMember } from 'discord.js';
import { botStateService } from './botState';
import { blacklistService } from './blacklist';
import { rateLimitService } from './rateLimit';
import { conversationContextService } from './conversationContext';
import { memoryService } from './memory';
import { memoryExtractionService } from './memoryExtraction';
import { permissionService } from './permissions';
import { addressingService } from './addressing';
import { personalityService } from './personality';
import { AIService, createAIService } from './ai';
import { responseSanitizer } from './responseSanitizer';
import { logger } from '../utils/logger';
import { env } from '../utils/env';

export class MessageRouter {
  private aiService: AIService;

  constructor() {
    this.aiService = createAIService(env.GROQ_API_KEY);
    // Inject AI service into memory extraction service
    memoryExtractionService.setAIService(this.aiService);
  }

  /**
   * Main message routing pipeline
   */
  async handleMessage(message: Message, botUserId: string): Promise<void> {
    try {
      // Ignore messages from bots (including self)
      if (message.author.bot) {
        return;
      }

      // Ignore messages without guild (DMs)
      if (!message.guild) {
        return;
      }

      const guildId = message.guild.id;
      const userId = message.author.id;
      const channelId = message.channelId;
      const content = message.content.trim();

      // Check for commands first
      if (content.startsWith('~')) {
        await this.handleCommand(message, content);
        return;
      }

      // Step 1: Check if Bot Kun is enabled for this guild
      const botEnabled = await botStateService.isEnabled(guildId);
      if (!botEnabled) {
        logger.debug(`Bot disabled for guild ${guildId}, ignoring message`);
        return;
      }

      // Step 2: Check if user is blacklisted
      const isBlacklisted = await blacklistService.isBlacklisted(userId, guildId);
      if (isBlacklisted) {
        logger.debug(`User ${userId} is blacklisted in guild ${guildId}`);
        // Don't respond to blacklisted users
        return;
      }

      // Step 3: Check if message is addressing Bot Kun
      const isAddressing = await addressingService.isAddressingBot(message, botUserId);
      if (!isAddressing) {
        // Not addressing Bot Kun, ignore (Phase 2 only responds when addressed)
        return;
      }

      // Step 4: Check rate limit
      const rateLimitCheck = rateLimitService.canInteract(userId);
      if (!rateLimitCheck.allowed) {
        logger.debug(`User ${userId} is rate limited`);
        if (rateLimitCheck.resetTime) {
          const cooldownMessage = personalityService.getCooldownMessage(rateLimitCheck.resetTime);
          await message.reply(cooldownMessage);
        }
        return;
      }

      // Step 5: Record the interaction
      rateLimitService.recordInteraction(userId);

      // Step 6: Add message to conversation context
      conversationContextService.addMessage(
        channelId,
        userId,
        message.author.username,
        message.content,
        false
      );

      // Step 7: Extract actual message content (remove bot name/mention)
      const cleanContent = addressingService.extractContent(message, botUserId);

      // Step 8: Get or create user profile
      let member: GuildMember | null = null;
      try {
        member = await message.guild.members.fetch(userId);
      } catch (error) {
        logger.warn('Failed to fetch guild member', { userId, guildId });
      }

      const userProfile = await memoryService.getOrCreateProfile(
        userId,
        guildId,
        message.author.username,
        message.member?.displayName || message.author.displayName
      );

      // Step 9: Update memory eligibility if we have member info
      if (member) {
        await memoryService.updateMemoryEligibility(userId, guildId, member);
      }

      // Step 10: Update last interaction time
      await memoryService.updateLastInteraction(userId, guildId);

      // Step 11: Extract memory candidates if eligible (non-blocking)
      if (userProfile.memoryEligible && await memoryService.isInActiveMemoryPool(userId, guildId)) {
        try {
          const conversationContext = conversationContextService.getFormattedContext(channelId);
          const extractionResult = await memoryExtractionService.extractMemories(
            cleanContent,
            message.author.username,
            conversationContext
          );
          
          if (extractionResult.success && extractionResult.candidates.length > 0) {
            await memoryService.processMemoryCandidates(userId, guildId, extractionResult.candidates);
            logger.debug(`Processed ${extractionResult.candidates.length} memory candidates for user ${userId}`);
          }
        } catch (error) {
          // Memory extraction failure should never block the main response
          logger.warn('Memory extraction failed, continuing with response', {
            userId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Step 12: Retrieve relevant memory if eligible
      let memoryContext = '';
      if (userProfile.memoryEligible && await memoryService.isInActiveMemoryPool(userId, guildId)) {
        const memories = await memoryService.getRelevantMemories(userId, guildId);
        memoryContext = memoryService.formatMemoriesForAI(memories);
      }

      // Step 13: Get conversation context
      const conversationContext = conversationContextService.getFormattedContext(channelId);

      // Step 14: Generate AI response
      const aiResponse = await this.aiService.generateResponse({
        systemPrompt: personalityService.getSystemPrompt(),
        userMessage: cleanContent,
        conversationContext,
        memoryContext,
        userName: message.author.username
      });

      // Step 15: Handle AI response
      if (aiResponse.success && aiResponse.content) {
        // Sanitize the response to prevent mention abuse and format leakage
        const sanitizedContent = responseSanitizer.sanitize(aiResponse.content);

        // Add Bot Kun's response to conversation context (use sanitized version)
        conversationContextService.addMessage(
          channelId,
          botUserId,
          'Bot Kun',
          sanitizedContent,
          true
        );

        // Send response with allowed mentions configuration to prevent mention parsing
        await message.reply({
          content: sanitizedContent,
          allowedMentions: {
            parse: [] // Disable all mention parsing
          }
        });
        logger.info(`Bot Kun responded to user ${userId} in guild ${guildId}`);
      } else {
        // AI failed, send error message
        const errorMessage = personalityService.getErrorMessage();
        await message.reply({
          content: errorMessage,
          allowedMentions: {
            parse: [] // Disable all mention parsing
          }
        });
        logger.error('AI response failed', {
          userId,
          guildId,
          error: aiResponse.error
        });
      }

    } catch (error) {
      logger.error('Error in message routing pipeline', {
        error: error instanceof Error ? error.message : String(error),
        userId: message.author.id,
        guildId: message.guild?.id
      });

      // Don't crash the bot on individual message errors
      // Just log and continue
    }
  }

  /**
   * Handle bot commands
   */
  private async handleCommand(message: Message, content: string): Promise<void> {
    const parts = content.split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
      case '~bot':
        if (parts[1] === 'on') {
          await this.handleBotOn(message);
        } else if (parts[1] === 'off') {
          await this.handleBotOff(message);
        }
        break;

      case '~bl':
        if (parts[1]) {
          // Extract user ID from mention
          const userIdMatch = parts[1].match(/<@!?(\d+)>/);
          if (userIdMatch) {
            await this.handleBlacklist(message, userIdMatch[1]);
          }
        }
        break;

      case '~unbl':
        if (parts[1]) {
          // Extract user ID from mention
          const userIdMatch = parts[1].match(/<@!?(\d+)>/);
          if (userIdMatch) {
            await this.handleUnblacklist(message, userIdMatch[1]);
          }
        }
        break;

      default:
        // Unknown command, ignore
        break;
    }
  }

  /**
   * Handle ~bot on command
   */
  private async handleBotOn(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      await botStateService.enable(message.guild.id);
      await message.reply('Bot Kun is now awake. Let\'s go.');
      logger.info(`Bot enabled for guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to enable bot', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to wake up Bot Kun. Try again later.');
    }
  }

  /**
   * Handle ~bot off command
   */
  private async handleBotOff(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      await botStateService.disable(message.guild.id);
      await message.reply('Bot Kun is going back to sleep. Peace.');
      logger.info(`Bot disabled for guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to disable bot', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to put Bot Kun to sleep. Try again later.');
    }
  }

  /**
   * Handle ~bl @user command
   */
  private async handleBlacklist(message: Message, targetUser: string): Promise<void> {
    if (!message.guild) return;

    // Permission check - only Extra+ can blacklist
    const member = message.member as GuildMember;
    if (!permissionService.hasMemoryEligibility(member)) {
      await message.reply('You don\'t have permission to blacklist people. Nice try though.');
      return;
    }

    try {
      await blacklistService.addToBlacklist(
        targetUser,
        message.guild.id,
        message.author.id
      );
      await message.reply('User has been blacklisted. They won\'t be bothering me anymore.');
      logger.info(`User ${targetUser} blacklisted in guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to blacklist user', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to blacklist user. Try again later.');
    }
  }

  /**
   * Handle ~unbl @user command
   */
  private async handleUnblacklist(message: Message, targetUser: string): Promise<void> {
    if (!message.guild) return;

    // Permission check - only Extra+ can unblacklist
    const member = message.member as GuildMember;
    if (!permissionService.hasMemoryEligibility(member)) {
      await message.reply('You don\'t have permission to unblacklist people. Nice try though.');
      return;
    }

    try {
      await blacklistService.removeFromBlacklist(targetUser, message.guild.id);
      await message.reply('User has been removed from blacklist. They can talk to me again.');
      logger.info(`User ${targetUser} unblacklisted in guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to unblacklist user', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to unblacklist user. Try again later.');
    }
  }
}

export const messageRouter = new MessageRouter();
