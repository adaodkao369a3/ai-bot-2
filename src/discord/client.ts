/**
 * Discord client setup for Bocchi
 * Creates Discord client with appropriate intents for planned functionality
 */

import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { logger } from '../utils/logger';
import { messageRouter } from '../services/messageRouter';
import { getNicknameService } from '../services/nickname';
import { getConfessionService } from '../services/confession';

export function createDiscordClient(): Client {
  // Create client with intents required for message-based interaction
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,           // Required for guild/server functionality
      GatewayIntentBits.GuildMessages,    // Required to receive messages in servers
      GatewayIntentBits.MessageContent,   // Required to read message content (privileged)
      GatewayIntentBits.GuildMembers,     // Required to detect new member joins
      // Future intents can be added here as needed:
      // GatewayIntentBits.GuildMessageReactions,
      // etc.
    ]
  });

  // Set up event handlers for connection lifecycle
  client.once('ready', async () => {
    logger.info('Discord client ready', {
      username: client.user?.tag,
      guilds: client.guilds.cache.size
    });
    
    // Set bot status to describe what it does
    if (client.user) {
      await client.user.setActivity('hoping nobody notices me...', { type: ActivityType.Watching });
    }

    // Recover active confession sessions
    const confessionService = getConfessionService();
    for (const [guildId, guild] of client.guilds.cache) {
      try {
        await confessionService.recoverActiveSessions(guild, async (session) => {
          // Handle expired session
          try {
            const boothChannel = await guild.channels.fetch(session.booth_channel_id);
            if (boothChannel && boothChannel.type === 0) { // GuildText
              await confessionService.revokeBoothAccess(boothChannel, session.user_id);
            }
            
            // Publish confession if there's content
            if (session.confession_text && session.confession_text.trim().length > 0) {
              const confessionNumber = await confessionService.getNextConfessionNumber(guildId);
              await confessionService.saveConfession(guildId, confessionNumber, session.confession_text);
              await confessionService.publishConfession(guild, confessionNumber, session.confession_text);
            }
          } catch (error) {
            logger.error('Failed to handle expired confession session during recovery', {
              sessionId: session.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
      } catch (error) {
        logger.error('Failed to recover confession sessions for guild', {
          guildId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  // Handle incoming messages
  client.on('messageCreate', async (message) => {
    if (!client.user) {
      logger.warn('Discord client user not available, skipping message');
      return;
    }
    
    await messageRouter.handleMessage(message, client.user.id);
  });

  // Handle button interactions
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const customId = interaction.customId;
    
    if (customId.startsWith('confession_enter_')) {
      await interaction.deferReply();
      // Create a mock message object for the handler
      const mockMessage = {
        guild: interaction.guild,
        author: interaction.user,
        channel: interaction.channel,
        channelId: interaction.channelId,
        reply: async (content: any) => {
          await interaction.editReply(content);
        }
      } as any;
      
      await messageRouter.handleConfessionEnter(mockMessage);
    } else if (customId.startsWith('confession_leave_')) {
      await interaction.deferReply();
      const mockMessage = {
        guild: interaction.guild,
        author: interaction.user,
        channel: interaction.channel,
        channelId: interaction.channelId,
        reply: async (content: any) => {
          await interaction.editReply(content);
        }
      } as any;
      
      await messageRouter.handleConfessionLeave(mockMessage);
    }
  });

  // Track last used welcome message index to avoid immediate repetition
  let lastWelcomeMessageIndex = -1;

  // Handle new member joins - only sends welcome to hardcoded channel
  client.on('guildMemberAdd', async (member) => {
    if (!client.user) {
      logger.warn('Discord client user not available, skipping member join');
      return;
    }

    // Hardcoded welcome channel ID (stage floor)
    const WELCOME_CHANNEL_ID = '1526872609717747762';

    // Assign nickname if member doesn't already have one and doesn't have owner role
    try {
      const nicknameService = getNicknameService();
      
      if (!nicknameService.hasNickname(member) && !nicknameService.hasOwnerRole(member)) {
        logger.info('Assigning nickname to new member', {
          userId: member.id,
          username: member.user.tag
        });
        
        await nicknameService.generateAndAssignNickname(member);
      } else if (nicknameService.hasOwnerRole(member)) {
        logger.info('Skipped nickname assignment for owner role member', {
          userId: member.id,
          username: member.user.tag
        });
      }
    } catch (error) {
      // Nickname assignment failure should not block the welcome message
      logger.warn('Failed to assign nickname to new member', {
        userId: member.id,
        username: member.user.tag,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Bocchi-style welcome messages pool (with USER_MENTION placeholder)
    const welcomeMessageTemplates = [
      `hii USER_MENTION welcome... please don't be scared, i'm already scared enough for both of us`,
      `oh... USER_MENTION joined. hi. welcome. um. yeah.`,
      `hii USER_MENTION welcome to the server!! please enjoy your stay... preferably without looking at me`,
      `USER_MENTION has arrived... everyone act normal. WAIT I DON'T KNOW HOW TO ACT NORMAL`,
      `uhh hi USER_MENTION... welcome to this place hehe`,
      `welcome USER_MENTION!! i was totally prepared for this interaction`,
      `h-hi USER_MENTION welcome!! please ignore how awkward this is`,
      `USER_MENTION joined!! this is probably a good thing. probably.`,
      `oh, you're new... hi USER_MENTION welcome to the chaos`,
      `welcome USER_MENTION... i hope you like it here because i have no idea what i'm doing`,
      `hii USER_MENTION welcome!! um... that's it. i practiced that`,
      `USER_MENTION welcome to the server!! please make yourself comfortable while i hide in the corner`,
      `new person detected... h-hi USER_MENTION welcome`,
      `everyone say hi to USER_MENTION!! ...wait why did i say that out loud`,
      `hii USER_MENTION welcome!! don't worry, i'm only slightly socially malfunctioning`,
      `USER_MENTION just joined... welcome. you can't leave now.`,
      `welcome USER_MENTION!! congrats on finding this place somehow`,
      `h-hi USER_MENTION... welcome to the server. please be nice to me`,
      `USER_MENTION has entered the stage... somebody do something.`,
      `welcome USER_MENTION!! i hope you have fun here... unlike me, probably`
    ];

    try {
      // Get the welcome channel
      const welcomeChannel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
      
      if (!welcomeChannel) {
        logger.warn('Welcome channel not found', { channelId: WELCOME_CHANNEL_ID });
        return;
      }

      // Check if channel is sendable (text-based)
      if (!welcomeChannel.isSendable()) {
        logger.warn('Welcome channel is not sendable', { channelId: WELCOME_CHANNEL_ID });
        return;
      }

      // Select a random welcome message template, avoiding immediate repetition
      let messageIndex;
      do {
        messageIndex = Math.floor(Math.random() * welcomeMessageTemplates.length);
      } while (messageIndex === lastWelcomeMessageIndex && welcomeMessageTemplates.length > 1);
      
      lastWelcomeMessageIndex = messageIndex;
      const selectedTemplate = welcomeMessageTemplates[messageIndex];

      // Replace the placeholder with the actual user mention
      const finalMessage = selectedTemplate.replace(/USER_MENTION/g, `<@${member.id}>`);

      // Send welcome message with proper mention settings to actually ping the user
      await welcomeChannel.send({
        content: finalMessage,
        allowedMentions: {
          users: [member.id], // Only allow mentioning the specific new member
          repliedUser: false
        }
      });
      
      logger.info('Welcome message sent', { 
        userId: member.id, 
        username: member.user.tag,
        channelId: WELCOME_CHANNEL_ID,
        messageIndex
      });
    } catch (error) {
      logger.error('Failed to send welcome message', {
        userId: member.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  client.on('error', (error) => {
    logger.error('Discord client error', { error: error.message });
  });

  return client;
}

export async function connectDiscord(client: Client, token: string): Promise<void> {
  try {
    logger.info('Connecting to Discord...');
    await client.login(token);
    logger.info('Discord connection established');
  } catch (error) {
    logger.error('Failed to connect to Discord', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export async function disconnectDiscord(client: Client): Promise<void> {
  try {
    logger.info('Disconnecting from Discord...');
    client.destroy();
    logger.info('Discord connection closed');
  } catch (error) {
    logger.error('Error during Discord disconnect', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}
