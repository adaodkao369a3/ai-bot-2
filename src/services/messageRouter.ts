/**
 * Message routing pipeline for Bocchi
 * Central message handling pipeline that coordinates all services
 */

import { Message, GuildMember, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
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
import { memeService } from './meme';
import { mediaService } from './media';
import { interactionPoolsService } from './interactionPools';
import { responseMemoryService } from './responseMemory';
import { initNicknameService, getNicknameService } from './nickname';
import { initConfessionService, getConfessionService } from './confession';
import { GUIDE_CHANNEL_ID } from '../config';
import { logger } from '../utils/logger';
import { env } from '../utils/env';

export class MessageRouter {
  private aiService: AIService;

  constructor() {
    this.aiService = createAIService(env.GROQ_API_KEY);
    // Inject AI service into memory extraction service
    memoryExtractionService.setAIService(this.aiService);
    // Initialize nickname service (no longer needs AI service)
    initNicknameService();
    // Initialize confession service
    initConfessionService();
  }

  /**
   * Normalize message for Order 66 trigger detection
   * Strips punctuation/symbols and normalizes whitespace
   */
  private normalizeForOrder66(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation/symbols
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Check if message is a confession trigger
   */
  private isConfessionTrigger(content: string): boolean {
    const lowerContent = content.toLowerCase();
    const triggers = [
      'i need to confess',
      'confession time',
      'i need to come clean',
      'confess something',
      'come clean'
    ];
    return triggers.some(trigger => lowerContent.includes(trigger));
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

      // Check for Order 66 trigger (admin only)
      const normalizedContent = this.normalizeForOrder66(content);
      if (normalizedContent === 'bocchi execute order 66') {
        await this.handleOrder66(message);
        return;
      }

      // Check for confession trigger
      if (this.isConfessionTrigger(content)) {
        await this.handleConfessionTrigger(message);
        return;
      }

      // Check if message is in confession booth
      const confessionService = getConfessionService();
      const activeSession = await confessionService.getActiveSession(guildId);
      if (activeSession && message.channelId === activeSession.booth_channel_id) {
        await this.handleBoothMessage(message);
        return;
      }

      // Fetch the guild member before any gates so staff/admins can bypass
      // bot-disabled, blacklist, and rate-limit restrictions.
      let member: GuildMember | null = null;
      try {
        member = await message.guild.members.fetch(userId);
      } catch (error) {
        logger.warn('Failed to fetch guild member', { userId, guildId });
      }

      const isStaff = member ? permissionService.isStaff(member) : false;

      // Step 1: Check if Bocchi is enabled for this guild.
      // Staff/admins bypass this gate.
      const botEnabled = await botStateService.isEnabled(guildId);
      if (!botEnabled && !isStaff) {
        logger.debug(`Bot disabled for guild ${guildId}, ignoring message`);
        return;
      }

      // Step 2: Check if user is blacklisted.
      // Staff/admins bypass blacklist restrictions.
      const isBlacklisted = await blacklistService.isBlacklisted(userId, guildId);
      if (isBlacklisted && !isStaff) {
        logger.debug(`User ${userId} is blacklisted in guild ${guildId}`);
        return;
      }

      // Step 3: Check if message is addressing Bocchi
      const isAddressing = await addressingService.isAddressingBot(message, botUserId);
      if (!isAddressing) {
        return;
      }

      // Step 5: Check rate limit (staff/admins bypass this entirely)
      if (!isStaff) {
        const rateLimitCheck = rateLimitService.canInteract(userId);
        if (!rateLimitCheck.allowed) {
          logger.debug(`User ${userId} is rate limited`);
          if (rateLimitCheck.resetTime) {
            const cooldownMessage = personalityService.getCooldownMessage(rateLimitCheck.resetTime);
            await message.reply(cooldownMessage);
          }
          return;
        }

        // Record the interaction
        rateLimitService.recordInteraction(userId);
      }

      // Step 6: Add message to conversation context and update activity
      const globalDisplayName = message.author.globalName ?? message.author.displayName;

      conversationContextService.addMessage(
        channelId,
        userId,
        globalDisplayName,
        message.content,
        false
      );

      // Step 7: Extract actual message content (remove bot name/mention)
      const cleanContent = addressingService.extractContent(message, botUserId);

      // Step 7.5: Security check for user input
      const securityCheck = responseSanitizer.securityCheck(cleanContent);
      if (!securityCheck.safe) {
        logger.warn(`Security check failed for user ${userId}`, {
          reason: securityCheck.reason,
          content: cleanContent.substring(0, 100)
        });
        
        // Respond playfully but don't comply
        const securityMessages = [
          'nice try bro',
          'you\'re funny for asking that',
          'nahhh not doing that',
          'bro really thought that would work',
          'you\'re gonna have to try harder than that'
        ];
        await message.reply({
          content: securityMessages[Math.floor(Math.random() * securityMessages.length)],
          allowedMentions: { parse: [], repliedUser: true, users: [userId] }
        });
        return;
      }

      // Explicit "I am X / my name is X / call me X" statements are stored
      // immediately so identity survives restarts and new conversations.
      const identityName = this.extractIdentityName(cleanContent);
      if (identityName) {
        await memoryService.rememberIdentity(userId, guildId, identityName);
      }

      // Step 9: Get or create user profile
      const userProfile = await memoryService.getOrCreateProfile(
        userId,
        guildId,
        globalDisplayName,
        globalDisplayName
      );

      // Step 10: Update memory eligibility if we have member info
      if (member) {
        await memoryService.updateMemoryEligibility(userId, guildId, member);
      }

      // Step 11: Update last interaction time
      await memoryService.updateLastInteraction(userId, guildId);

      // Use the freshly fetched Discord roles for this interaction rather
      // than the profile row from before eligibility was updated.
      const memoryEligible = member
        ? permissionService.hasMemoryEligibility(member)
        : userProfile.memoryEligible;

      // Step 12: Extract memory candidates if eligible (non-blocking)
      if (memoryEligible && await memoryService.isInActiveMemoryPool(userId, guildId)) {
        try {
          const conversationContext = conversationContextService.getFormattedContext(channelId);
          const extractionResult = await memoryExtractionService.extractMemories(
            cleanContent,
            globalDisplayName,
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

      // Step 13: Identity is always available to the user themselves.
      // Optional preference/interest memory remains role-gated.
      const identityMemories = await memoryService.getIdentityMemories(userId, guildId);
      let memoryContext = [
        `The user's account-level Discord display name is ${globalDisplayName}.`,
        memoryService.formatMemoriesForAI(identityMemories)
      ].filter(Boolean).join('\n');

      if (memoryEligible && await memoryService.isInActiveMemoryPool(userId, guildId)) {
        const memories = await memoryService.getRelevantMemories(userId, guildId);
        const generalMemoryContext = memoryService.formatMemoriesForAI(memories);
        memoryContext = [memoryContext, generalMemoryContext].filter(Boolean).join('\n');
      }

      // Step 14: Get conversation context
      const conversationContext = conversationContextService.getFormattedContext(channelId);

      // Step 14.5: Check if user is replying to another message and fetch reply context
      let replyContext = '';
      if (message.reference) {
        try {
          const referencedMessage = await message.fetchReference();
          if (referencedMessage && referencedMessage.content) {
            const originalAuthor = referencedMessage.author.globalName || referencedMessage.author.displayName;
            const currentUser = globalDisplayName;
            
            // Structure the reply context to clearly distinguish between current user and referenced message
            replyContext = `REFERENCED MESSAGE CONTEXT:
The user is replying to a message by ${originalAuthor}.
Referenced message content: "${referencedMessage.content}"
Current user: ${currentUser}
Current message: "${cleanContent}"

When the user asks about "they", "them", "that person", "this guy", "he", "she", etc., they are referring to ${originalAuthor} and their message, not ${currentUser}.`;
            
            logger.debug('Fetched reply context', {
              userId,
              originalAuthor,
              currentUser,
              originalMessage: referencedMessage.content.substring(0, 50)
            });
          }
        } catch (error) {
          // If we can't fetch the referenced message, just continue without reply context
          logger.debug('Failed to fetch referenced message for reply context', {
            userId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Step 15: Explicit media requests are handled as one-shot actions.
      // Do not also generate an AI reply or auto-drop a meme for the same text.
      const mediaHandled = await this.handleExplicitMediaRequest(
        message,
        cleanContent,
        conversationContext
      );
      if (mediaHandled) {
        return;
      }

      // Step 16: Generate AI response
      // Show the "Bocchi is typing..." indicator in Discord while we work,
      // and keep refreshing it since a typing indicator only lasts ~10s.
      const stopTyping = this.startTypingIndicator(message);
      let aiResponse;
      try {
        aiResponse = await this.aiService.generateResponse({
          systemPrompt: personalityService.getSystemPrompt(),
          userMessage: cleanContent,
          conversationContext,
          memoryContext,
          replyContext,
          userName: globalDisplayName
        });
      } finally {
        stopTyping();
      }

      // Step 17: Handle AI response
      if (aiResponse.success && aiResponse.content) {
        // Sanitize the response to prevent mention abuse and format leakage
        const sanitizedContent = responseSanitizer.sanitize(aiResponse.content);

        // Add to response memory to avoid repetition
        responseMemoryService.addResponse(sanitizedContent);

        // Add Bocchi's response to conversation context (use sanitized version)
        conversationContextService.addMessage(
          channelId,
          botUserId,
          'Bocchi',
          sanitizedContent,
          true
        );

        // Send response with allowed mentions configuration to prevent mention parsing
        await message.reply({
          content: sanitizedContent,
          allowedMentions: {
            parse: [],
            repliedUser: true,
            users: [userId]
          }
        });
        logger.info(`Bocchi responded to user ${userId} in guild ${guildId}`);
      } else {
        // AI failed, send error message
        const errorMessage = personalityService.getErrorMessage();
        await message.reply({
          content: errorMessage,
          allowedMentions: {
            parse: [],
            repliedUser: true,
            users: [userId]
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
   * Start sending the "Bocchi is typing..." indicator in the channel and
   * keep refreshing it (Discord's typing indicator only lasts ~10s) until
   * the returned function is called to stop.
   */
  private startTypingIndicator(message: Message): () => void {
    const channel = message.channel;
    if (!('sendTyping' in channel)) {
      return () => {};
    }

    const sendTyping = () => {
      channel.sendTyping().catch((error: unknown) => {
        logger.debug('Failed to send typing indicator', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    };

    // Fire immediately, then refresh every 8s so it doesn't expire mid-response
    sendTyping();
    const interval = setInterval(sendTyping, 8000);

    return () => clearInterval(interval);
  }

  /**
   * Handle explicit meme/GIF/YouTube requests. Returns true when the
   * message was a media request and therefore should not get a second reply.
   */
  private async handleExplicitMediaRequest(
    message: Message,
    cleanContent: string,
    conversationContext: string
  ): Promise<boolean> {
    const content = cleanContent.toLowerCase();

    if (this.isMemeRequest(content)) {
      const category = this.extractMemeCategory(content);
      const meme = await memeService.fetchMeme(`${conversationContext}\n${cleanContent}`, category);
      if (!meme) {
        const messages = [
          'nahhh couldn\'t find one',
          'couldn\'t find anything good',
          'no luck finding one',
          'search failed, try again'
        ];
        await message.reply({
          content: messages[Math.floor(Math.random() * messages.length)],
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        return true;
      }

      const successMessages = [
        'found one',
        'here you go',
        'gotchu',
        'pulling one up now'
      ];
      await message.reply({
        content: successMessages[Math.floor(Math.random() * successMessages.length)],
        embeds: [
          new EmbedBuilder()
            .setImage(meme.imageUrl)
            .setColor(0xFFA500)
        ],
        allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
      });
      return true;
    }

    const gifAction = this.extractGifAction(content);
    if (gifAction) {
      const interactionResponse = await interactionPoolsService.getInteractionResponse(gifAction);
      if (!interactionResponse) {
        const messages = [
          `couldn't find a ${gifAction} gif right now`,
          `no ${gifAction} gif found`,
          `search failed for ${gifAction}`,
          `can't find a ${gifAction} gif`
        ];
        await message.reply({
          content: messages[Math.floor(Math.random() * messages.length)],
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        return true;
      }

      if (interactionResponse.gif) {
        await message.reply({
          content: interactionResponse.text,
          embeds: [
            new EmbedBuilder()
              .setImage(interactionResponse.gif.url)
              .setColor(0x9B59B6)
          ],
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
      } else {
        await message.reply({
          content: interactionResponse.text,
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
      }
      return true;
    }

    const youtubeQuery = this.extractYoutubeQuery(content);
    if (youtubeQuery) {
      const video = await mediaService.searchYoutube(youtubeQuery);
      if (!video) {
        const messages = [
          'nahhh couldn\'t find one',
          'couldn\'t find that video',
          'search came up empty',
          'no results found'
        ];
        await message.reply({
          content: messages[Math.floor(Math.random() * messages.length)],
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        return true;
      }

      // IMPORTANT: use the watch URL as message content, not an EmbedBuilder
      // URL. Discord renders this as its native YouTube video player.
      const successMessages = [
        'found one',
        'here you go',
        'gotchu',
        'pulling it up now'
      ];
      await message.reply({
        content: `${successMessages[Math.floor(Math.random() * successMessages.length)]}\nhttps://www.youtube.com/watch?v=${video.videoId}`,
        allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
      });
      return true;
    }

    return false;
  }

  private isMemeRequest(content: string): boolean {
    return /(?:pull|show|get|send|give|find|bring|drop|post|want)\b[\s\S]{0,60}\bmeme(?:s)?\b/i.test(content)
      || /\bmeme(?:s)?\s*(?:please|pls|plz)?$/i.test(content)
      || /^(?:meme|memes)$/i.test(content);
  }

  private extractMemeCategory(content: string): string | undefined {
    const categoryPatterns = [
      // Direct patterns: "anime meme", "meme about cats", etc.
      /\b(jojo|anime|manga|cat|kitten|dog|puppy|programming|coding|code|developer|gaming|games|game|gamer|wholesome|cute|school|college|homework|work|office|job|boss|minecraft|fortnite|valorant|sports|football|basketball|soccer|music|movies|film|tv|politics|science|math|history|food|cooking|fitness|gym|cars|technology|tech|phones|crypto|bitcoin|nft|dank|funny|reaction)\s+meme/i,
      /\bmeme\s+(?:of|about|for|with|like)\s+(jojo|anime|manga|cat|kitten|dog|puppy|programming|coding|code|developer|gaming|games|game|gamer|wholesome|cute|school|college|homework|work|office|job|boss|minecraft|fortnite|valorant|sports|football|basketball|soccer|music|movies|film|tv|politics|science|math|history|food|cooking|fitness|gym|cars|technology|tech|phones|crypto|bitcoin|nft|dank|funny|reaction)/i,
      // Topic-only patterns: "give me a cat meme" -> extract "cat"
      /(?:show|get|give|pull|send|find)\s+(?:me\s+)?(?:a\s+)?(?:\w+\s+)?meme\s+(?:about|of|with|for|like)?\s*(\w+)/i,
      // Direct topic mentions in meme requests
      /meme\s*(?:about|of|with|for|like)?\s*(\w+)/i
    ];

    for (const pattern of categoryPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractGifAction(content: string): string | null {
    const actions = [
      'high five',
      'hug',
      'cuddle',
      'kiss',
      'punch',
      'kick',
      'slap',
      'pat',
      'wave',
      'cry',
      'laugh',
      'dance'
    ];

    for (const action of actions) {
      const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:gif\\s*(?:me)?\\s*)?${escaped}\\s+me\\b`, 'i').test(content)) {
        return action;
      }
    }

    return null;
  }

  private extractYoutubeQuery(content: string): string | null {
    if (!/\b(?:asmr|youtube|video|song|music|playlist)\b/i.test(content)) {
      return null;
    }

    const query = content
      .replace(/^(?:please\s+)?(?:pull\s+up|show|play|find|get|send|give\s+me|bring\s+me)\s*/i, '')
      .replace(/\b(?:on\s+)?youtube\b/gi, '')
      .replace(/\b(?:a|the)\s+(?:video|song|playlist)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return query || null;
  }

  private extractIdentityName(content: string): string | null {
    const match = content.match(
      /^(?:i\\s*(?:am|'m|’m)|im|my\\s+name\\s+is|call\\s+me)\\s+([A-Za-z][A-Za-z0-9'_-]{1,31}(?:\\s+[A-Za-z][A-Za-z0-9'_-]{1,31})?)/i
    );

    if (!match) {
      return null;
    }

    const name = match[1].trim();
    if (/^(?:not|a|an|the)$/i.test(name)) {
      return null;
    }

    return name;
  }

  /**
   * Handle bot commands
   */
  private async handleCommand(message: Message, content: string): Promise<void> {
    const parts = content.split(' ');
    const command = parts[0].toLowerCase();

    // Check if user is staff for admin commands
    let member: GuildMember | null = null;
    try {
      member = message.guild ? await message.guild.members.fetch(message.author.id) : null;
    } catch (error) {
      logger.warn('Failed to fetch guild member for command', { 
        userId: message.author.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const isStaff = member ? permissionService.isStaff(member) : false;

    switch (command) {
      case '~bot':
        // Only staff can use ~bot on/off
        if (!isStaff) {
          await message.reply({
            content: 'nice try bro, only admins can use that command',
            allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
          });
          return;
        }
        
        if (parts[1] === 'on') {
          await this.handleBotOn(message);
        } else if (parts[1] === 'off') {
          await this.handleBotOff(message);
        }
        break;

      case '~bl':
        // Only staff can use blacklist commands
        if (!isStaff) {
          await message.reply({
            content: 'nice try bro, only admins can use that command',
            allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
          });
          return;
        }
        
        if (parts[1]) {
          // Extract user ID from mention
          const userIdMatch = parts[1].match(/<@!?(\d+)>/);
          if (userIdMatch) {
            await this.handleBlacklist(message, userIdMatch[1]);
          }
        } else {
          // No target given - show the blacklist list
          await this.handleListBlacklist(message);
        }
        break;

      case '~unbl':
        // Only staff can use blacklist commands
        if (!isStaff) {
          await message.reply({
            content: 'nice try bro, only admins can use that command',
            allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
          });
          return;
        }
        
        if (parts[1]) {
          // Extract user ID from mention
          const userIdMatch = parts[1].match(/<@!?(\d+)>/);
          if (userIdMatch) {
            await this.handleUnblacklist(message, userIdMatch[1]);
          }
        }
        break;

      case '~guide':
        // Only staff can use guide command
        if (!isStaff) {
          await message.reply({
            content: 'nice try bro, only admins can use that command',
            allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
          });
          return;
        }
        
        await this.handleGuide(message);
        break;

      case '~nickname':
        // Only staff can use nickname commands
        if (!isStaff) {
          await message.reply({
            content: 'nice try bro, only admins can use that command',
            allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
          });
          return;
        }

        if (parts[1] === 'all') {
          await this.handleNicknameAll(message);
        } else if (parts[1] === 'reset' && parts[2] === 'all') {
          await this.handleNicknameResetAll(message);
        } else if (parts[1] === 'reset' && parts[2]) {
          // Extract user ID from mention
          const userIdMatch = parts[2].match(/<@!?(\d+)>/);
          if (userIdMatch) {
            await this.handleNicknameResetUser(message, userIdMatch[1]);
          }
        } else if (parts[1]) {
          // Extract user ID from mention
          const userIdMatch = parts[1].match(/<@!?(\d+)>/);
          if (userIdMatch) {
            await this.handleNicknameUser(message, userIdMatch[1]);
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
      const messages = [
        'i\'m online now...',
        'ready... i guess...',
        'online...',
        'here...'
      ];
      await message.reply(messages[Math.floor(Math.random() * messages.length)]);
      logger.info(`Bot enabled for guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to enable bot', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('failed to start... sorry...');
    }
  }

  /**
   * Handle ~bot off command
   */
  private async handleBotOff(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      await botStateService.disable(message.guild.id);
      const messages = [
        'going offline now...',
        'bye...',
        'taking a break...',
        'see you...'
      ];
      await message.reply(messages[Math.floor(Math.random() * messages.length)]);
      logger.info(`Bot disabled for guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to disable bot', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('failed to stop... sorry...');
    }
  }

  /**
   * Handle ~bl (no target) - show the current blacklist in an embed
   */
  private async handleListBlacklist(message: Message): Promise<void> {
    if (!message.guild) return;

    // Same permission tier as adding/removing from the blacklist
    const member = message.member as GuildMember;
    if (!permissionService.hasMemoryEligibility(member)) {
      await message.reply('You don\'t have permission to view the blacklist. Nice try though.');
      return;
    }

    try {
      const entries = await blacklistService.getBlacklist(message.guild.id);

      const embed = new EmbedBuilder()
        .setTitle('🚫 Blacklisted Users')
        .setColor(0xE74C3C);

      if (entries.length === 0) {
        embed.setDescription('Nobody\'s blacklisted right now.');
      } else {
        // <@id> renders as a clickable username in an embed without
        // actually pinging/notifying the person (embeds don't trigger pings)
        const lines = await Promise.all(entries.map(async entry => {
          const when = `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:d>`;
          const reason = entry.reason ? ` — ${entry.reason}` : '';
          const name = await this.getGlobalUserName(message, entry.userId);
          return `${name} (blacklisted ${when}${reason})`;
        }));
        embed.setDescription(lines.join('\n'));
        embed.setFooter({ text: `${entries.length} blacklisted user${entries.length === 1 ? '' : 's'}` });
      }

      await message.reply({
        embeds: [embed],
        allowedMentions: {
          parse: [] // Renders mentions as clickable but does not ping anyone
        }
      });
    } catch (error) {
      logger.error('Failed to list blacklist', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to fetch the blacklist. Try again later.');
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
      const targetName = await this.getGlobalUserName(message, targetUser);
      await message.reply(`${targetName} has been blacklisted. They won\'t be bothering me anymore.`);
      logger.info(`User ${targetUser} (${targetName}) blacklisted in guild ${message.guild.id} by ${message.author.id}`);
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
      const targetName = await this.getGlobalUserName(message, targetUser);
      await message.reply(`${targetName} has been removed from blacklist. They can talk to me again.`);
      logger.info(`User ${targetUser} (${targetName}) unblacklisted in guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to unblacklist user', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to unblacklist user. Try again later.');
    }
  }

  /**
   * Handle ~guide command
   * Admin-only command to post the Bot-Kun guide embed in the designated channel
   */
  private async handleGuide(message: Message): Promise<void> {
    if (!message.guild) return;

    const member = message.member as GuildMember;
    
    // Permission check - only staff with memory eligibility can use ~guide
    if (!permissionService.hasMemoryEligibility(member)) {
      await message.reply('You don\'t have permission to use that command. Nice try though.');
      return;
    }

    // Check if command is used in the designated guide channel
    if (GUIDE_CHANNEL_ID && message.channelId !== GUIDE_CHANNEL_ID) {
      await message.reply('This command can only be used in the designated rules/overview channel.');
      return;
    }

    // Ensure channel is a guild-based channel that supports .send()
    if (!message.channel.isSendable()) {
      await message.reply('This command cannot be used in this channel type.');
      return;
    }

    try {
      // Create the guide embed
      const guideEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('Bocchi\'s Little Guide')
        .setDescription('So... who is Bocchi?\n\nBocchi is a socially anxious Discord presence who somehow ended up here and now has to talk to people. She\'s awkward, overthinks everything, but tries her best.\n\nShe\'s here to chat, share memes, find videos, and generally try to be social despite the overwhelming anxiety.\n\nYou don\'t really need complicated commands. Just talk to her normally.')
        .addFields(
          {
            name: 'Talk to Bocchi',
            value: 'Mention her or just say Bocchi and start talking.\n\n```\nBocchi what\'s up?\n@Bocchi tell me something\nBocchi do you like cats?\n```\n\nShe\'ll try her best. Probably.',
            inline: false
          },
          {
            name: 'Memes',
            value: 'Need a distraction?\n\nTry:\n\n```\nmeme\npull a meme\nshow me a meme\ncat meme\nanime meme\ngaming meme\ncoding meme\n```\n\nYou can be specific if you want.',
            inline: false
          },
          {
            name: 'GIF Reactions',
            value: 'Want Bocchi to react?\n\n```\nhug me · kiss me · cuddle me\npat me · high five me · wave at me\npunch me · kick me · slap me\ncry · laugh · dance\n```\n\nShe might panic a bit, but she\'ll try.',
            inline: false
          },
          {
            name: 'Videos & YouTube',
            value: 'Need something to watch?\n\n```\nplay [song]\nfind [song] on youtube\nshow me a video of [topic]\nget me some asmr\n```\n\nShe\'ll search for it.',
            inline: false
          },
          {
            name: 'Memory',
            value: 'You can tell Bocchi your name:\n\n```\nmy name is Alex\ncall me Alex\n```\n\nShe\'ll remember it for future conversations.',
            inline: false
          },
          {
            name: 'And sometimes...',
            value: 'If the channel gets quiet for a while, Bocchi might randomly appear with a meme.\n\nNobody asked.\nShe just felt like it.',
            inline: false
          },
          {
            name: 'That\'s basically it.',
            value: 'Talk to her. Ask for memes. Get some GIFs. Find a video.\n\nBocchi will be around.',
            inline: false
          }
        );

      // Delete the command message first
      await message.delete();

      // Send the guide embed (channel is now narrowed to sendable type)
      await message.channel.send({ embeds: [guideEmbed] });

      logger.info(`Guide embed posted by ${message.author.id} in channel ${message.channelId}`);
    } catch (error) {
      logger.error('Failed to post guide embed', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to post the guide. Try again later.');
    }
  }
  /**
   * Handle ~nickname @user command
   * Generate a new nickname for a specific user (admin/staff only)
   */
  private async handleNicknameUser(message: Message, targetUserId: string): Promise<void> {
    if (!message.guild) return;

    try {
      const nicknameService = getNicknameService();
      const member = await message.guild.members.fetch(targetUserId);

      if (!member) {
        await message.reply({
          content: 'Could not find that user.',
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        return;
      }

      // Generate and assign new nickname (overwrites existing if present)
      const result = await nicknameService.generateAndAssignNickname(member);

      if (result.success) {
        const targetName = await this.getGlobalUserName(message, targetUserId);
        await message.reply({
          content: `assigned a new nickname to ${targetName}`,
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        logger.info(`Nickname regenerated for user ${targetUserId} (${targetName}) by ${message.author.id}`);
      } else {
        let errorMessage = 'failed to generate a nickname... sorry...';
        if (result.error === 'role_hierarchy') {
          errorMessage = 'cannot modify that user due to role hierarchy';
        }
        await message.reply({
          content: errorMessage,
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
      }
    } catch (error) {
      logger.error('Failed to handle nickname user command', {
        targetUserId,
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply({
        content: 'something went wrong... try again later',
        allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
      });
    }
  }

  /**
   * Handle ~nickname all command
   * Generate nicknames for all members without existing nicknames (admin/staff only)
   */
  private async handleNicknameAll(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const nicknameService = getNicknameService();
      
      // ALWAYS fetch the complete guild member list for bulk operations
      // Do not rely on cache as it may not contain all members
      logger.info('Fetching complete guild member list for bulk nickname operation');
      const members = await message.guild.members.fetch();
      
      // Build nickname set from the fetched members to avoid another fetch
      const nicknameSet = new Set<string>();
      members.forEach(member => {
        if (member.nickname) {
          nicknameSet.add(member.nickname.toLowerCase());
        }
      });
      
      let processed = 0;
      let skippedOwnerRole = 0;
      let skippedBot = 0;
      let skippedSelf = 0;
      let skippedAlreadyHasNickname = 0;
      let skippedHierarchy = 0;
      let failed = 0;
      let success = 0;

      await message.reply({
        content: 'processing all members without nicknames... this might take a while',
        allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
      });

      // Process ALL members sequentially to avoid rate limit issues
      for (const [memberId, member] of members) {
        // Skip Bocchi itself
        if (memberId === message.guild.members.me?.id) {
          skippedSelf++;
          logger.debug('Skipped Bocchi itself', { userId: memberId });
          continue;
        }

        // Skip owner role members FIRST (before any other checks)
        if (nicknameService.hasOwnerRole(member)) {
          skippedOwnerRole++;
          logger.debug('Skipped member due to owner role', { userId: memberId });
          continue;
        }

        // Skip bots
        if (member.user.bot) {
          skippedBot++;
          continue;
        }

        // Skip members who already have a nickname
        if (nicknameService.hasNickname(member)) {
          skippedAlreadyHasNickname++;
          continue;
        }

        processed++;

        try {
          const nickname = await nicknameService.generateUniqueNickname(nicknameSet);
          
          if (nickname) {
            const result = await nicknameService.assignNickname(member, nickname);
            
            if (result.success) {
              success++;
              // Add to nickname set to avoid duplicates
              nicknameSet.add(nickname.toLowerCase());
              // Small delay between operations to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 500));
            } else if (result.error === 'role_hierarchy') {
              skippedHierarchy++;
              logger.info('Skipped member due to role hierarchy', { userId: memberId });
            } else {
              failed++;
            }
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          logger.warn('Failed to assign nickname during bulk operation', {
            userId: memberId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const summary = `done... processed ${processed} members, ${success} successful, ${failed} failed, ${skippedOwnerRole} skipped (owner role), ${skippedBot} skipped (bot), ${skippedSelf} skipped (self), ${skippedAlreadyHasNickname} skipped (has nickname), ${skippedHierarchy} skipped (role hierarchy)`;
      if (message.channel.isSendable()) {
        await message.channel.send({
          content: summary,
          allowedMentions: { parse: [] }
        });
      }

      logger.info('Bulk nickname operation completed', {
        totalMembers: members.size,
        processed,
        success,
        failed,
        skippedOwnerRole,
        skippedBot,
        skippedSelf,
        skippedAlreadyHasNickname,
        skippedHierarchy,
        guildId: message.guild.id,
        requestedBy: message.author.id
      });
    } catch (error) {
      logger.error('Failed to handle nickname all command', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (message.channel.isSendable()) {
        await message.channel.send({
          content: 'something went wrong during the bulk operation... check logs',
          allowedMentions: { parse: [] }
        });
      }
    }
  }

  /**
   * Handle ~nickname reset @user command
   * Remove a user's server nickname (admin/staff only)
   */
  private async handleNicknameResetUser(message: Message, targetUserId: string): Promise<void> {
    if (!message.guild) return;

    try {
      const nicknameService = getNicknameService();
      const member = await message.guild.members.fetch(targetUserId);

      if (!member) {
        await message.reply({
          content: 'Could not find that user.',
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        return;
      }

      // Check if user has a nickname to remove
      if (!nicknameService.hasNickname(member)) {
        await message.reply({
          content: 'that user doesn\'t have a nickname to remove',
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        return;
      }

      const result = await nicknameService.removeNickname(member);

      if (result.success) {
        const targetName = await this.getGlobalUserName(message, targetUserId);
        await message.reply({
          content: `removed ${targetName}'s nickname`,
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
        logger.info(`Nickname removed for user ${targetUserId} (${targetName}) by ${message.author.id}`);
      } else {
        let errorMessage = 'failed to remove nickname... sorry...';
        if (result.error === 'role_hierarchy') {
          errorMessage = 'cannot modify that user due to role hierarchy';
        }
        await message.reply({
          content: errorMessage,
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
      }
    } catch (error) {
      logger.error('Failed to handle nickname reset user command', {
        targetUserId,
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply({
        content: 'something went wrong... try again later',
        allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
      });
    }
  }

  /**
   * Handle ~nickname reset all command
   * Remove server nicknames from all members who have them (admin/staff only)
   */
  private async handleNicknameResetAll(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const nicknameService = getNicknameService();
      
      // ALWAYS fetch the complete guild member list for bulk operations
      // Do not rely on cache as it may not contain all members
      logger.info('Fetching complete guild member list for bulk nickname reset operation');
      const members = await message.guild.members.fetch();
      
      let processed = 0;
      let skippedOwnerRole = 0;
      let skippedBot = 0;
      let skippedSelf = 0;
      let skippedNoNickname = 0;
      let skippedHierarchy = 0;
      let failed = 0;
      let success = 0;

      await message.reply({
        content: 'removing all server nicknames... this might take a while',
        allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
      });

      // Process ALL members sequentially to avoid rate limit issues
      for (const [memberId, member] of members) {
        // Skip Bocchi itself
        if (memberId === message.guild.members.me?.id) {
          skippedSelf++;
          logger.debug('Skipped Bocchi itself', { userId: memberId });
          continue;
        }

        // Skip owner role members FIRST (before any other checks)
        if (nicknameService.hasOwnerRole(member)) {
          skippedOwnerRole++;
          logger.debug('Skipped member due to owner role', { userId: memberId });
          continue;
        }

        // Skip bots
        if (member.user.bot) {
          skippedBot++;
          continue;
        }

        // Skip members who don't have a nickname
        if (!nicknameService.hasNickname(member)) {
          skippedNoNickname++;
          continue;
        }

        processed++;

        try {
          const result = await nicknameService.removeNickname(member);
          
          if (result.success) {
            success++;
            // Small delay between operations to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
          } else if (result.error === 'role_hierarchy') {
            skippedHierarchy++;
            logger.info('Skipped member due to role hierarchy', { userId: memberId });
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          logger.warn('Failed to remove nickname during bulk operation', {
            userId: memberId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const summary = `done... processed ${processed} members, ${success} successful, ${failed} failed, ${skippedOwnerRole} skipped (owner role), ${skippedBot} skipped (bot), ${skippedSelf} skipped (self), ${skippedNoNickname} skipped (no nickname), ${skippedHierarchy} skipped (role hierarchy)`;
      if (message.channel.isSendable()) {
        await message.channel.send({
          content: summary,
          allowedMentions: { parse: [] }
        });
      }

      logger.info('Bulk nickname reset operation completed', {
        totalMembers: members.size,
        processed,
        success,
        failed,
        skippedOwnerRole,
        skippedBot,
        skippedSelf,
        skippedNoNickname,
        skippedHierarchy,
        guildId: message.guild.id,
        requestedBy: message.author.id
      });
    } catch (error) {
      logger.error('Failed to handle nickname reset all command', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (message.channel.isSendable()) {
        await message.channel.send({
          content: 'something went wrong during the bulk operation... check logs',
          allowedMentions: { parse: [] }
        });
      }
    }
  }

  /**
   * Handle Order 66 trigger (admin only)
   * Times out users from recent messages
   */
  private async handleOrder66(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      // Check if user is admin/staff
      let member: GuildMember | null = null;
      try {
        member = await message.guild.members.fetch(message.author.id);
      } catch (error) {
        logger.warn('Failed to fetch guild member for Order 66', { userId: message.author.id });
        return;
      }

      if (!member || !permissionService.isStaff(member)) {
        logger.warn('Non-staff attempted Order 66', { userId: message.author.id });
        return;
      }

      logger.info('Order 66 executed by admin', { userId: message.author.id, guildId: message.guild.id });

      // Send the GIF
      const ORDER_66_GIF = 'https://64.media.tumblr.com/a45e47255b2ed611d657bda6566b8b8f/00241dda5d4be5ac-c9/s540x810/55671d66feb384a7e5ba12c5eb36bad84586fa5a.gif';
      if (message.channel.isSendable()) {
        await message.channel.send(ORDER_66_GIF);
      }

      // Fetch the 10 most recent messages in the channel
      const messages = await message.channel.messages.fetch({ limit: 10, before: message.id });

      // Collect unique human users from those messages
      const victimSet = new Set<string>();
      for (const [msgId, msg] of messages) {
        if (!msg.author.bot && msg.author.id !== message.author.id && msg.author.id !== message.client.user?.id) {
          victimSet.add(msg.author.id);
        }
      }

      const victims = Array.from(victimSet);
      const successfulTimeouts: string[] = [];

      // Timeout each victim for 30 seconds
      for (const victimId of victims) {
        try {
          const victimMember = await message.guild.members.fetch(victimId);
          
          // Check if we can timeout this member (role hierarchy check)
          await victimMember.timeout(30 * 1000, 'Order 66');
          successfulTimeouts.push(victimId);
          logger.info('Timed out victim for Order 66', { victimId });
          
          // Small delay between timeouts
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn('Failed to timeout victim for Order 66', {
            victimId,
            error: errorMessage
          });
          // Continue with next victim even if this one fails
        }
      }

      // Send final message with mentions
      const mentions = successfulTimeouts.map(id => `<@${id}>`).join(' ');
      const victimCount = successfulTimeouts.length;
      const finalMessage = victimCount > 0 
        ? `executed ${mentions}. ${victimCount} victims. arrivederci`
        : `executed nobody. 0 victims. arrivederci`;

      if (message.channel.isSendable()) {
        await message.channel.send(finalMessage);
      }

      logger.info('Order 66 completed', {
        executorId: message.author.id,
        totalVictims: victims.length,
        successfulTimeouts: successfulTimeouts.length,
        guildId: message.guild.id
      });
    } catch (error) {
      logger.error('Failed to execute Order 66', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle confession trigger
   */
  private async handleConfessionTrigger(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const confessionService = getConfessionService();
      const activeSession = await confessionService.getActiveSession(message.guild.id);

      if (activeSession) {
        // Booth is occupied
        const responses = [
          'wait your turn, someone\'s confessing 💀',
          'wait. someone\'s already in the booth. have some shame and patience.',
          'the booth is occupied. wait your turn.'
        ];
        const response = responses[Math.floor(Math.random() * responses.length)];
        
        if (message.channel.isSendable()) {
          await message.reply({
            content: response,
            allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
          });
        }
        return;
      }

      // Booth is available, show button
      const responses = [
        'okay... come to the booth.',
        'alright... the booth is open.',
        'come to the booth.'
      ];
      const response = responses[Math.floor(Math.random() * responses.length)];

      const enterButton = new ButtonBuilder()
        .setCustomId(`confession_enter_${message.author.id}`)
        .setLabel('🚪 Enter Confession Booth')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(enterButton);

      if (message.channel.isSendable()) {
        await message.reply({
          content: response,
          components: [row],
          allowedMentions: { parse: [], repliedUser: true, users: [message.author.id] }
        });
      }

      logger.info('Confession booth offered', {
        userId: message.author.id,
        guildId: message.guild.id
      });
    } catch (error) {
      logger.error('Failed to handle confession trigger', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle Enter Confession Booth button click
   */
  async handleConfessionEnter(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const confessionService = getConfessionService();
      
      // Try to create session atomically
      const boothChannel = await confessionService.getOrCreateBoothChannel(message.guild);
      if (!boothChannel) {
        if (message.channel.isSendable()) {
          await message.reply('failed to create booth channel... try again later');
        }
        return;
      }

      const session = await confessionService.createSession(
        message.guild.id,
        message.author.id,
        boothChannel.id
      );

      if (!session) {
        // Someone else got there first
        if (message.channel.isSendable()) {
          await message.reply('wait your turn, someone\'s confessing 💀');
        }
        return;
      }

      // Grant access to booth
      const accessGranted = await confessionService.grantBoothAccess(boothChannel, message.author.id);
      if (!accessGranted) {
        await confessionService.endSession(session.id);
        if (message.channel.isSendable()) {
          await message.reply('failed to grant booth access... try again later');
        }
        return;
      }

      // Send booth introduction
      const intro = 'alright... you\'re in the booth now.\nyou have 5 minutes. tell me your sins.';
      if (boothChannel.isSendable()) {
        await boothChannel.send(intro);
      }

      // Start timer
      confessionService.startTimer(session.id, message.guild.id, message.author.id, async () => {
        await this.endConfessionSession(message.guild, session.id, boothChannel.id, message.author.id);
      });

      logger.info('Confession session started', {
        sessionId: session.id,
        userId: message.author.id,
        guildId: message.guild.id
      });

      if (message.channel.isSendable()) {
        await message.reply('you\'re in the booth now. check your DMs or the booth channel.');
      }
    } catch (error) {
      logger.error('Failed to handle confession enter', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle Leave Confession Booth button click
   */
  async handleConfessionLeave(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const confessionService = getConfessionService();
      const activeSession = await confessionService.getActiveSession(message.guild.id);

      if (!activeSession || activeSession.user_id !== message.author.id) {
        if (message.channel.isSendable()) {
          await message.reply('you\'re not in the booth...');
        }
        return;
      }

      await this.endConfessionSession(message.guild, activeSession.id, activeSession.booth_channel_id, message.author.id);

      if (message.channel.isSendable()) {
        await message.reply('you may go now. arrivederci.');
      }
    } catch (error) {
      logger.error('Failed to handle confession leave', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * End a confession session
   */
  private async endConfessionSession(guild: Guild, sessionId: number, boothChannelId: string, userId: string): Promise<void> {
    try {
      const confessionService = getConfessionService();
      
      // Get session data before ending
      const session = await confessionService.getActiveSession(guild.id);
      if (!session) return;

      // Revoke access
      try {
        const boothChannel = await guild.channels.fetch(boothChannelId);
        if (boothChannel && boothChannel.type === 0) { // GuildText
          await confessionService.revokeBoothAccess(boothChannel, userId);
        }
      } catch (error) {
        logger.error('Failed to revoke booth access during session end', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // End session in database
      await confessionService.endSession(sessionId, session.confession_text);

      // Publish confession if there's content
      if (session.confession_text && session.confession_text.trim().length > 0) {
        try {
          const confessionNumber = await confessionService.getNextConfessionNumber(guild.id);
          await confessionService.saveConfession(guild.id, confessionNumber, session.confession_text);
          await confessionService.publishConfession(guild, confessionNumber, session.confession_text);
        } catch (error) {
          logger.error('Failed to publish confession', {
            sessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      logger.info('Confession session ended', {
        sessionId,
        guildId: guild.id,
        userId
      });
    } catch (error) {
      logger.error('Failed to end confession session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle confession booth messages
   */
  async handleBoothMessage(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const confessionService = getConfessionService();
      const activeSession = await confessionService.getActiveSession(message.guild.id);

      if (!activeSession || activeSession.user_id !== message.author.id) {
        return; // Not the active confessor
      }

      // Check for end confession command
      const normalizedContent = message.content.toLowerCase().trim();
      if (normalizedContent === 'bocchi end confession') {
        await this.endConfessionSession(message.guild, activeSession.id, activeSession.booth_channel_id, message.author.id);
        
        if (message.channel.isSendable()) {
          await message.reply('yes my child. you may go now.');
        }
        return;
      }

      // Update confession text (append to existing)
      const currentText = activeSession.confession_text || '';
      const newText = currentText ? `${currentText}\n${message.content}` : message.content;
      await confessionService.updateConfessionText(activeSession.id, newText);

      // Add Leave button to every message
      const leaveButton = new ButtonBuilder()
        .setCustomId(`confession_leave_${message.author.id}`)
        .setLabel('🚪 Leave Confession Booth')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(leaveButton);

      if (message.channel.isSendable()) {
        await message.channel.send({
          content: '...',
          components: [row]
        });
      }

      // Process as normal AI response (isolated conversation)
      // This will be handled by the normal message flow after this check
    } catch (error) {
      logger.error('Failed to handle booth message', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Discord User#displayName/globalName is the account-level display name,
   * not the server nickname and not the username.
   */
  private async getGlobalUserName(message: Message, userId: string): Promise<string> {
    try {
      const user = await message.client.users.fetch(userId);
      return user.globalName ?? user.displayName;
    } catch (error) {
      logger.warn('Failed to fetch global user name', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 'User';
    }
  }

}

export const messageRouter = new MessageRouter();
