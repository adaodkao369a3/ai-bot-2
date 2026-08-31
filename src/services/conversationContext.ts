/**
 * Conversation context service for Bocchi
 * Maintains bounded recent message history for AI context
 */

import { CONVERSATION_CONTEXT_MAX_MESSAGES } from '../config';
import { logger } from '../utils/logger';

export interface ContextMessage {
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  isBot: boolean;
}

export class ConversationContextService {
  // channelId -> array of recent messages
  private contexts: Map<string, ContextMessage[]> = new Map();
  private readonly MAX_MESSAGES_PER_CHANNEL = CONVERSATION_CONTEXT_MAX_MESSAGES;
  private readonly MAX_CHANNELS = 1000; // Maximum number of channels to track
  private readonly CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Clean up every 10 minutes

  constructor() {
    this.startCleanupTask();
  }

  /**
   * Start periodic cleanup of old contexts
   */
  private startCleanupTask(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    logger.debug('Conversation context cleanup task started');
  }

  /**
   * Clean up old contexts and enforce channel limit
   */
  private cleanup(): void {
    const now = Date.now();
    let cleanedChannels = 0;
    let cleanedMessages = 0;

    for (const [channelId, messages] of this.contexts.entries()) {
      // Remove messages older than TTL
      const validMessages = messages.filter(msg => 
        now - msg.timestamp < this.CONTEXT_TTL_MS
      );

      if (validMessages.length !== messages.length) {
        cleanedMessages += messages.length - validMessages.length;
        if (validMessages.length === 0) {
          this.contexts.delete(channelId);
          cleanedChannels++;
        } else {
          this.contexts.set(channelId, validMessages);
        }
      }
    }

    // If tracking too many channels, remove oldest ones
    if (this.contexts.size > this.MAX_CHANNELS) {
      const channelsToRemove = this.contexts.size - this.MAX_CHANNELS;
      let removed = 0;
      
      for (const [channelId] of this.contexts.entries()) {
        if (removed >= channelsToRemove) break;
        cleanedMessages += this.contexts.get(channelId)!.length;
        this.contexts.delete(channelId);
        removed++;
      }

      logger.warn(`Conversation context exceeded max channels, removed ${removed} oldest channels`);
    }

    if (cleanedChannels > 0 || cleanedMessages > 0) {
      logger.debug(`Conversation context cleanup: ${cleanedChannels} channels, ${cleanedMessages} messages`);
    }
  }

  /**
   * Add a message to the conversation context
   */
  addMessage(
    channelId: string,
    userId: string,
    username: string,
    content: string,
    isBot: boolean
  ): void {
    const message: ContextMessage = {
      userId,
      username,
      content,
      timestamp: Date.now(),
      isBot
    };

    let messages = this.contexts.get(channelId);
    
    if (!messages) {
      messages = [];
      this.contexts.set(channelId, messages);
    }

    // Add message and enforce size limit
    messages.push(message);
    if (messages.length > this.MAX_MESSAGES_PER_CHANNEL) {
      messages.shift(); // Remove oldest message
    }

    logger.debug(`Added message to context for channel ${channelId}: ${messages.length}/${this.MAX_MESSAGES_PER_CHANNEL}`);
  }

  /**
   * Get recent conversation context for a channel
   */
  getContext(channelId: string): ContextMessage[] {
    const messages = this.contexts.get(channelId);
    if (!messages) {
      return [];
    }

    // Return a copy to prevent external modification
    return [...messages];
  }

  /**
   * Get formatted context string for AI prompt
   */
  getFormattedContext(channelId: string): string {
    const messages = this.getContext(channelId);
    if (messages.length === 0) {
      return '';
    }

    return messages
      .map(msg => {
        const sender = msg.isBot ? 'Bocchi' : msg.username;
        return `${sender}: ${msg.content}`;
      })
      .join('\n');
  }

  /**
   * Clear context for a specific channel
   */
  clearChannel(channelId: string): void {
    this.contexts.delete(channelId);
    logger.debug(`Cleared conversation context for channel ${channelId}`);
  }

  /**
   * Clear all contexts (useful for testing)
   */
  clearAll(): void {
    this.contexts.clear();
    logger.debug('All conversation contexts cleared');
  }

  /**
   * Get current context size for monitoring
   */
  getContextSize(): number {
    let total = 0;
    for (const messages of this.contexts.values()) {
      total += messages.length;
    }
    return total;
  }

  /**
   * Get number of tracked channels
   */
  getChannelCount(): number {
    return this.contexts.size;
  }

  /**
   * Stop cleanup task (for graceful shutdown)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('Conversation context cleanup task stopped');
    }
  }
}

export const conversationContextService = new ConversationContextService();
