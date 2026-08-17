/**
 * Meme service for Bot Kun v2
 * Tracks how many times each user has talked to Bot Kun and, every 2-3
 * exchanges, drops an actual meme pulled from a public meme API.
 * This is NOT the AI trying to "be meme-ish" - it's a real image post.
 */

import {
  MEME_API_URL,
  MEME_MIN_MESSAGES_BEFORE_DROP,
  MEME_MAX_MESSAGES_BEFORE_DROP,
  MEME_FETCH_TIMEOUT_MS
} from '../config';
import { logger } from '../utils/logger';

interface MemeApiResponse {
  title: string;
  url: string;
  postLink: string;
  subreddit: string;
  nsfw?: boolean;
  spoiler?: boolean;
}

export interface Meme {
  title: string;
  imageUrl: string;
  postLink: string;
  subreddit: string;
}

interface UserMemeState {
  countSinceLastMeme: number;
  threshold: number;
}

export class MemeService {
  // userId -> tracking state (global per user; not per-channel, matches the
  // "after 2 or 3 texts with someone" behavior)
  private state: Map<string, UserMemeState> = new Map();

  private randomThreshold(): number {
    const min = MEME_MIN_MESSAGES_BEFORE_DROP;
    const max = MEME_MAX_MESSAGES_BEFORE_DROP;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private getOrCreateState(userId: string): UserMemeState {
    let entry = this.state.get(userId);
    if (!entry) {
      entry = { countSinceLastMeme: 0, threshold: this.randomThreshold() };
      this.state.set(userId, entry);
    }
    return entry;
  }

  /**
   * Record an exchange with a user and return true if it's time to drop a meme.
   * Resets the counter (with a fresh random threshold) whenever it triggers.
   */
  shouldDropMeme(userId: string): boolean {
    const entry = this.getOrCreateState(userId);
    entry.countSinceLastMeme++;

    if (entry.countSinceLastMeme >= entry.threshold) {
      entry.countSinceLastMeme = 0;
      entry.threshold = this.randomThreshold();
      return true;
    }

    return false;
  }

  /**
   * Fetch a single meme from the meme API. Filters out NSFW/spoiler results
   * by retrying a couple times, since this posts straight into a server.
   */
  async fetchMeme(): Promise<Meme | null> {
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MEME_FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(MEME_API_URL, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Meme API error: ${response.status}`);
        }

        const data = (await response.json()) as MemeApiResponse;

        if (!data.url || !data.title) {
          throw new Error('Invalid response format from meme API');
        }

        if (data.nsfw || data.spoiler) {
          logger.debug('Skipping NSFW/spoiler meme, retrying', { attempt });
          continue;
        }

        return {
          title: data.title,
          imageUrl: data.url,
          postLink: data.postLink,
          subreddit: data.subreddit
        };
      } catch (error) {
        clearTimeout(timeoutId);
        logger.warn('Failed to fetch meme, will retry if attempts remain', {
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.warn('Giving up on fetching a meme after all attempts');
    return null;
  }

  /**
   * Clear all tracked state (useful for testing)
   */
  clearAll(): void {
    this.state.clear();
  }
}

export const memeService = new MemeService();
