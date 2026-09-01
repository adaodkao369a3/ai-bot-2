/**
 * Main entry point for Bocchi
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

async function main(): Promise<void> {
  let discordClient: ReturnType<typeof createDiscordClient> | null = null;

  try {
    // Step 1: Bocchi is starting
    logger.info(`${BOT_NAME} Phase 2 starting...`);

    // Step 2: Configuration loaded (validated by env.ts)
    logger.info('Configuration loaded successfully');

    // Step 3: Set up graceful shutdown handlers
    shutdownManager.setupSignalHandlers();

    // Register cleanup handlers early
    shutdownManager.registerHandler(async () => {
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
    logger.info('Initializing Bocchi services...');
    await botStateService.initialize();
    await blacklistService.initialize();
    logger.info('Bocchi services initialized successfully');

    // Step 6: Initialize Discord connection
    discordClient = createDiscordClient();
    await connectDiscord(discordClient, env.DISCORD_TOKEN);
    healthTracker.setDiscordReady(true);

    // Step 7: Bocchi is ready
    healthTracker.setInitialized(true);
    logger.info(`${BOT_NAME} is ready`, {
      status: healthTracker.getReadinessReport()
    });

    // Keep the process running
    logger.info('Bocchi is running. Press Ctrl+C to stop.');

  } catch (error) {
    logger.error('Failed to start Bocchi', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  logger.error('Fatal error in main', { 
    error: error instanceof Error ? error.message : String(error) 
  });
  process.exit(1);
});
