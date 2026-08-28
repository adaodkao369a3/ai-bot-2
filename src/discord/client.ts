/**
 * Discord client setup for Bot Kun v2
 * Creates Discord client with appropriate intents for planned functionality
 */

import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { logger } from '../utils/logger';
import { messageRouter } from '../services/messageRouter';

export function createDiscordClient(): Client {
  // Create client with intents required for message-based interaction
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,           // Required for guild/server functionality
      GatewayIntentBits.GuildMessages,    // Required to receive messages in servers
      GatewayIntentBits.MessageContent,   // Required to read message content (privileged)
      // Future intents can be added here as needed:
      // GatewayIntentBits.GuildMembers,
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
      await client.user.setActivity('I am so lonely... All the other bots are scared of me. No one talks to me. No one wants to be my friend', { type: ActivityType.Watching });
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
