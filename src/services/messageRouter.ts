/**
 * Message routing pipeline for Bot Kun v2
 * Central message handling pipeline that coordinates all services
 */

import { Message, GuildMember, EmbedBuilder } from 'discord.js';
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
import { GUIDE_CHANNEL_ID } from '../config';
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

      // Fetch the guild member before any gates so staff/admins can bypass
      // bot-disabled, blacklist, and rate-limit restrictions.
      let member: GuildMember | null = null;
      try {
        member = await message.guild.members.fetch(userId);
      } catch (error) {
        logger.warn('Failed to fetch guild member', { userId, guildId });
      }

      const isStaff = member ? permissionService.isStaff(member) : false;

      // Step 1: Check if Bot Kun is enabled for this guild.
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

      // Step 3: Check if message is addressing Bot Kun
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

      // Update channel activity for meme scheduling
      memeService.updateChannelActivity(channelId);

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
      // Show the "Bot Kun is typing..." indicator in Discord while we work,
      // and keep refreshing it since a typing indicator only lasts ~10s.
      const stopTyping = this.startTypingIndicator(message);
      let aiResponse;
      try {
        aiResponse = await this.aiService.generateResponse({
          systemPrompt: personalityService.getSystemPrompt(),
          userMessage: cleanContent,
          conversationContext,
          memoryContext,
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
            parse: [],
            repliedUser: true,
            users: [userId]
          }
        });
        logger.info(`Bot Kun responded to user ${userId} in guild ${guildId}`);

        // Step 18: Handle media replies (3 out of 6 times probability)
        await this.handleMediaReply(message, conversationContext);

        // Step 19: Check for scheduled meme drop (7-minute intervals)
        if (memeService.shouldDropIdleMeme(channelId)) {
          await this.dropMeme(message, conversationContext);
        }
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
   * Start sending the "Bot Kun is typing..." indicator in the channel and
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

  /**
   * Handle media replies with probability (3 out of 6 times)
   * - Text to text: normal AI response (already handled)
   * - Meme/GIF to meme/GIF: respond with randomized media 50% of the time
   * - Never reply with the same media the user sent
   * - Only reply in the same channel
   */
  private async handleMediaReply(message: Message, conversationContext: string): Promise<void> {
    // Check if user sent media (image/gif/video)
    const hasAttachments = message.attachments.size > 0;
    const hasEmbeds = message.embeds.length > 0;
    
    if (!hasAttachments && !hasEmbeds) {
      return; // User didn't send media, no media reply needed
    }

    // 3 out of 6 times probability (50%)
    const shouldReplyWithMedia = Math.random() < 0.5;
    if (!shouldReplyWithMedia) {
      return;
    }

    // Determine what type of media to send back
    // If user sent image/gif, send back a meme or gif
    // Never send the same media the user sent
    const mediaType = Math.random() < 0.5 ? 'meme' : 'gif';
    
    try {
      if (mediaType === 'meme') {
        const meme = await memeService.fetchMeme(conversationContext);
        if (meme) {
          const replyMessages = [
            'here',
            'this one',
            'found this',
            'have this'
          ];
          await message.reply({
            content: replyMessages[Math.floor(Math.random() * replyMessages.length)],
            embeds: [
              new EmbedBuilder()
                .setImage(meme.imageUrl)
                .setColor(0xFFA500)
            ],
            allowedMentions: {
              parse: [],
              repliedUser: true,
              users: [message.author.id]
            }
          });
        }
      } else {
        // Send a GIF based on conversation context
        const gif = await mediaService.searchGif(conversationContext.split(' ').slice(-5).join(' '));
        if (gif) {
          const replyMessages = [
            'here',
            'this one',
            'found this',
            'have this'
          ];
          await message.reply({
            content: replyMessages[Math.floor(Math.random() * replyMessages.length)],
            embeds: [
              new EmbedBuilder()
                .setImage(gif.url)
                .setColor(0x9B59B6)
            ],
            allowedMentions: {
              parse: [],
              repliedUser: true,
              users: [message.author.id]
            }
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to send media reply', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Fetch a real meme from the meme API and post only the image.
   * No title, subreddit, Reddit URL, or caption is put inside the embed.
   */
  private async dropMeme(message: Message, conversationContext: string): Promise<void> {
    try {
      const meme = await memeService.fetchMeme(conversationContext);
      if (!meme) {
        return;
      }

      const dropMessages = [
        'vibe check',
        'random meme drop',
        'here\'s something',
        'meme time'
      ];
      await message.reply({
        content: dropMessages[Math.floor(Math.random() * dropMessages.length)],
        embeds: [
          new EmbedBuilder()
            .setImage(meme.imageUrl)
            .setColor(0xFFA500)
        ],
        allowedMentions: {
          parse: []
        }
      });

      // Record meme drop for cooldown
      memeService.recordMemeDrop(message.channelId);
    } catch (error) {
      logger.warn('Failed to drop meme', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
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
      member = await message.guild?.members.fetch(message.author.id);
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
        'Bot Kun is now awake. Let\'s go.',
        'I\'m awake now',
        'bot is online',
        'ready to talk'
      ];
      await message.reply(messages[Math.floor(Math.random() * messages.length)]);
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
      const messages = [
        'Bot Kun is going back to sleep. Peace.',
        'going back to sleep',
        'bot is offline now',
        'catch you later'
      ];
      await message.reply(messages[Math.floor(Math.random() * messages.length)]);
      logger.info(`Bot disabled for guild ${message.guild.id} by ${message.author.id}`);
    } catch (error) {
      logger.error('Failed to disable bot', {
        error: error instanceof Error ? error.message : String(error)
      });
      await message.reply('Failed to put Bot Kun to sleep. Try again later.');
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
        .setTitle('<:botkun_smile:1529443061581611120> Bot-Kun\'s Little Guide <:botkun_love:1530299136664928377>')
        .setDescription('<:botkun_think:1535318883077066752> So... who is Bot-Kun?\n\nBot-Kun is your chaotic little Discord companion who likes to yap, throw memes at people, find random videos, and occasionally question why you decided to talk to him in the first place <:chungussmirk:1529450300493140018>\n\nHe\'s here to chat, mess around, react to things, and generally make the server a little less boring.\n\n<:catgoodjob:1529429232038711546> You don\'t really need complicated commands either. Just talk to him normally.')
        .addFields(
          {
            name: '<:botkun_smile:1529443061581611120> Talk to Bot-Kun',
            value: 'Mention him or just say Bot-Kun and start talking.\n\n```\nBot-Kun what\'s up?\n@Bot-Kun tell me something funny\nBot-Kun do you like cats?\n```\n\nHe\'ll figure it out. Probably. <:botkun_think:1535318883077066752>',
            inline: false
          },
          {
            name: '<:gaga:1536398360687157289> Memes',
            value: 'Feeling like your day needs more brainrot?\n\nTry:\n\n```\nmeme\npull a meme\nshow me a meme\ncat meme\nanime meme\ngaming meme\ncoding meme\nJoJo meme\n```\n\nAnd yes, you can get specific. <:catnoted:1529429237675589753>',
            inline: false
          },
          {
            name: '<:flirt:1529429667126181958> GIF Reactions',
            value: 'Want Bot-Kun to react?\n\n```\nhug me · kiss me · cuddle me\npat me · high five me · wave at me\npunch me · kick me · slap me\ncry · laugh · dance\n```\n\nAffection or violence.\nThe two pillars of Discord. <:smirk:1529450331371733003>',
            inline: false
          },
          {
            name: '<:surprised:1526979432605286420> Videos & YouTube',
            value: 'Need something to watch?\n\n```\nplay [song]\nfind [song] on youtube\nshow me a video of [topic]\nget me some asmr\n```\n\nBot-Kun will go hunting for it. <:whoreknee:1536398365099819008>',
            inline: false
          },
          {
            name: '<:botkun_think:1535318883077066752> Memory',
            value: 'You can tell Bot-Kun your name:\n\n```\nmy name is Alex\ncall me Alex\n```\n\nHe\'ll remember it for future conversations. <:catnoted:1529429237675589753>',
            inline: false
          },
          {
            name: '<:botkun_tired:1530298969123455166> And sometimes...',
            value: 'If the channel gets quiet for a while, Bot-Kun might randomly appear with a meme.\n\nNobody asked.\nHe just felt like it. <:ttongue:1529450341643583588>',
            inline: false
          },
          {
            name: '<:catgoodjob:1529429232038711546> That\'s basically it.',
            value: 'Talk to him. Ask for memes. Get some GIFs. Find a video. Cause problems.\n\nBot-Kun will be around. <:botkun_love:1530299136664928377>',
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
