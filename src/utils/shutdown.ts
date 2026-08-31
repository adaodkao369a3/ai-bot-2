/**
 * Graceful shutdown handlers for Bocchi
 * Handles SIGINT and SIGTERM for clean shutdown, important for Railway
 */

import { logger } from './logger';

type ShutdownHandler = () => Promise<void> | void;

class ShutdownManager {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  registerHandler(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }

  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring signal', { signal });
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    // Execute all registered shutdown handlers
    for (const handler of this.handlers) {
      try {
        await handler();
      } catch (error) {
        logger.error('Error during shutdown handler execution', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  }

  setupSignalHandlers(): void {
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.shutdown('SIGINT').catch((error) => {
        logger.error('Error during SIGINT shutdown', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        process.exit(1);
      });
    });

    // Handle SIGTERM (sent by Railway and other process managers)
    process.on('SIGTERM', () => {
      this.shutdown('SIGTERM').catch((error) => {
        logger.error('Error during SIGTERM shutdown', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { 
        error: error.message, 
        stack: error.stack 
      });
      this.shutdown('UNCAUGHT_EXCEPTION').catch(() => {
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection', { 
        reason: reason instanceof Error ? reason.message : String(reason) 
      });
      this.shutdown('UNHANDLED_REJECTION').catch(() => {
        process.exit(1);
      });
    });

    logger.info('Signal handlers registered');
  }
}

export const shutdownManager = new ShutdownManager();
