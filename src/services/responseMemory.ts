/**
 * Response memory service
 * Tracks the bot's recent replies per channel so it can notice when it is about to
 * say the same thing again.
 *
 * Note: this used to be global and isTooSimilar() was never actually called. It is now
 * per channel, ignores emoji / punctuation differences ("lmao no 💀" == "lmao no 😭"),
 * and the message router checks it before every reply.
 */

import { logger } from '../utils/logger';
import { REPLY_REPEAT_WINDOW, REPLY_REPEAT_TTL_MS, REPLY_SIMILARITY_THRESHOLD } from '../config';

interface RecentReply {
  raw: string;
  normalized: string;
  at: number;
}

export class ResponseMemoryService {
  // channelId -> recent replies, oldest first
  private recentByChannel: Map<string, RecentReply[]> = new Map();
  private readonly MAX_CHANNELS = 500;

  constructor(
    private readonly windowSize: number = REPLY_REPEAT_WINDOW,
    private readonly ttlMs: number = REPLY_REPEAT_TTL_MS,
    private readonly threshold: number = REPLY_SIMILARITY_THRESHOLD,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Add a response to memory for a channel
   */
  addResponse(response: string, channelId: string = 'global'): void {
    const list = this.getFresh(channelId);
    list.push({ raw: response, normalized: this.normalizeResponse(response), at: this.now() });

    while (list.length > this.windowSize) {
      list.shift();
    }

    // Keep the channel "newest" and bound how many channels we track
    this.recentByChannel.delete(channelId);
    this.recentByChannel.set(channelId, list);
    while (this.recentByChannel.size > this.MAX_CHANNELS) {
      const oldest = this.recentByChannel.keys().next().value as string;
      this.recentByChannel.delete(oldest);
    }
  }

  /**
   * Check if a response is too similar to a recent one in the same channel
   */
  isTooSimilar(response: string, channelId: string = 'global'): boolean {
    const normalized = this.normalizeResponse(response);
    if (!normalized) {
      return false;
    }

    for (const recent of this.getFresh(channelId)) {
      if (this.calculateSimilarity(normalized, recent.normalized) >= this.threshold) {
        logger.debug('Reply is too similar to a recent reply', { channelId });
        return true;
      }
    }

    return false;
  }

  /**
   * The latest replies in a channel (newest last), for telling the AI what not to repeat
   */
  getRecent(channelId: string, count: number): string[] {
    return this.getFresh(channelId).slice(-count).map(reply => reply.raw);
  }

  /**
   * Replies still inside the time window for a channel
   */
  private getFresh(channelId: string): RecentReply[] {
    const list = this.recentByChannel.get(channelId) ?? [];
    const cutoff = this.now() - this.ttlMs;
    const fresh = list.filter(reply => reply.at >= cutoff);
    if (fresh.length !== list.length) {
      this.recentByChannel.set(channelId, fresh);
    }
    return fresh;
  }

  /**
   * Normalize response for comparison: lowercase, custom emoji and punctuation removed,
   * so "lmao no 💀" and "Lmao no!" compare as the same reply. An emoji-only reply keeps
   * its emoji so "💀" is only a repeat of "💀".
   */
  private normalizeResponse(response: string): string {
    const words = response
      .toLowerCase()
      .replace(/<a?:\w+:\d+>/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (words) {
      return words;
    }

    return response.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Similarity between two normalized strings (0-1).
   * Very short replies ("fine", "lol no") only count as a repeat when identical, because
   * a word-overlap score is meaningless for 1-3 words.
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;

    const words1 = str1.split(' ');
    const words2 = str2.split(' ');
    if (words1.length <= 3 || words2.length <= 3) {
      return 0;
    }

    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = [...set1].filter(word => set2.has(word)).length;
    const union = new Set([...set1, ...set2]).size;

    return intersection / union;
  }

  /**
   * Clear all memory (useful for testing)
   */
  clearMemory(): void {
    this.recentByChannel.clear();
  }

  /**
   * Get current memory size (replies tracked across all channels)
   */
  getMemorySize(): number {
    let total = 0;
    for (const list of this.recentByChannel.values()) {
      total += list.length;
    }
    return total;
  }
}

export const responseMemoryService = new ResponseMemoryService();
