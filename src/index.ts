/**
 * Main entry point for Bot Kun v2
 * Phase 2: Core brain and persistence implementation
 */

import { BOT_NAME } from './config';
import { env } from './utils/env';
import { logger } from './utils/logger';
import { createDiscordClient, connectDiscord, disconnectDiscord } from './discord/client';
import { createPool, testConnection, disconnectPool } from './database/pool';
import { healthTracker } from './services/health';
import { shutdownManager } from './utils/shutdown';
import { botStateService } from './services/botState';
import { blacklistService } from './services/blacklist';
import { rateLimitService } from './services/rateLimit';
import { conversationContextService } from './services/conversationContext';
import { memeService } from './services/meme';
import { Client, EmbedBuilder } from 'discord.js';

async function main(): Promise<void> {
  let discordClient: ReturnType<typeof createDiscordClient> | null = null;
  let memeCheckInterval: NodeJS.Timeout | null = null;

  try {
    // Step 1: Bot Kun is starting
    logger.info(`${BOT_NAME} v2 Phase 2 starting...`);

    // Step 2: Configuration loaded (validated by env.ts)
    logger.info('Configuration loaded successfully');

    // Step 3: Set up graceful shutdown handlers
    shutdownManager.setupSignalHandlers();

    // Register cleanup handlers early
    shutdownManager.registerHandler(async () => {
      if (memeCheckInterval) {
        clearInterval(memeCheckInterval);
      }
      if (discordClient) {
        await disconnectDiscord(discordClient);
      }
      await disconnectPool();
      
      // Shutdown services with cleanup tasks
      rateLimitService.shutdown();
      conversationContextService.shutdown();
      memeService.clearAll();
    });

    // Step 4: Initialize PostgreSQL connection pool (Supabase-hosted Postgres)
    const pool = createPool(env.SUPABASE_DATABASE_URL);
    const dbConnected = await testConnection(pool);
    healthTracker.setSupabaseReady(dbConnected);

    if (!dbConnected) {
      // Fail loudly and refuse to continue: a Discord client that comes online
      // while persistence is broken would silently pretend to work while
      // memory, blacklist, and bot-state features fail underneath it.
      throw new Error(
        'Failed to establish PostgreSQL connection using SUPABASE_DATABASE_URL. ' +
        'Refusing to start Discord client with broken persistence.'
      );
    }

    // Step 5: Initialize services with database-backed data
    logger.info('Initializing Bot Kun services...');
    await botStateService.initialize();
    await blacklistService.initialize();
    logger.info('Bot Kun services initialized successfully');

    // Step 6: Initialize Discord connection
    discordClient = createDiscordClient();
    await connectDiscord(discordClient, env.DISCORD_TOKEN);
    healthTracker.setDiscordReady(true);

    // Step 7: Start background meme scheduler
    if (discordClient) {
      const client = discordClient; // Capture non-null client for the interval
      memeCheckInterval = setInterval(async () => {
        try {
          await checkAndDropMemes(client);
        } catch (error) {
          logger.error('Error in meme scheduler', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }, 60000); // Check every minute
      logger.info('Meme scheduler started (15-minute intervals with reply detection)');
    }

    // Step 8: Bot Kun is ready
    healthTracker.setInitialized(true);
    logger.info(`${BOT_NAME} is ready`, {
      status: healthTracker.getReadinessReport()
    });

    // Keep the process running
    logger.info('Bot Kun is running. Press Ctrl+C to stop.');

  } catch (error) {
    logger.error('Failed to start Bot Kun', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  }
}

/**
 * Background task to check for scheduled meme drops
 * This runs every minute to see if any channels need a meme drop
 */
async function checkAndDropMemes(client: Client): Promise<void> {
  if (!client.user) return;

  // Get all channels where the bot is present and active
  for (const guild of client.guilds.cache.values()) {
    const botEnabled = await botStateService.isEnabled(guild.id);
    if (!botEnabled) continue;

    // Check all text channels in the guild
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased() || channel.isDMBased()) continue;

      try {
        // Initialize channel state if needed
        memeService.initializeChannel(channel.id);
        
        // Check if this channel should get a meme drop
        if (memeService.shouldDropIdleMeme(channel.id)) {
          // Get the last message in the channel to have context
          const messages = await channel.messages.fetch({ limit: 1 });
          const lastMessage = messages.first();
          
          if (lastMessage && !lastMessage.author.bot) {
            // Drop a meme with conversation context
            const conversationContext = lastMessage.content || '';
            const meme = await memeService.fetchMeme(conversationContext);
            
            if (meme) {
              const dropMessages = [
                'vibe check',
                'random meme drop',
                'here\'s something',
                'meme time'
              ];
              
              await channel.send({
                content: dropMessages[Math.floor(Math.random() * dropMessages.length)],
                embeds: [
                  new EmbedBuilder()
                    .setImage(meme.imageUrl)
                    .setColor(0xFFA500)
                ]
              });
              
              memeService.recordMemeDrop(channel.id);
              logger.info(`Dropped scheduled meme in channel ${channel.id}`);
            }
          }
        }
      } catch (error) {
        // Skip channels we can't access
        continue;
      }
    }
  }
}

// Start the application
main().catch((error) => {
  logger.error('Fatal error in main', { 
    error: error instanceof Error ? error.message : String(error) 
  });
  process.exit(1);
});
