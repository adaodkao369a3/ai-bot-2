/**
 * Meme service for Bot Kun.
 * Fetches real memes from the meme API with validation and fallback.
 * Supports idle-based meme drops and explicit meme requests.
 */

import {
  MEME_API_URL,
  MEME_IDLE_ENABLED,
  MEME_IDLE_INACTIVITY_MINUTES,
  MEME_IDLE_PROBABILITY,
  MEME_IDLE_COOLDOWN_MINUTES,
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
  verified: boolean;
}

interface ChannelIdleState {
  lastMessageTime: number;
  lastMemeDropTime: number;
}

export class MemeService {
  private channelStates: Map<string, ChannelIdleState> = new Map();

  /**
   * Check if a meme should be dropped based on idle time
   */
  shouldDropIdleMeme(channelId: string): boolean {
    if (!MEME_IDLE_ENABLED) {
      return false;
    }

    const now = Date.now();
    const state = this.channelStates.get(channelId);

    if (!state) {
      return false;
    }

    const inactiveMs = now - state.lastMessageTime;
    const inactiveMinutes = inactiveMs / (60 * 1000);
    const cooldownMs = MEME_IDLE_COOLDOWN_MINUTES * 60 * 1000;
    const timeSinceLastMeme = now - state.lastMemeDropTime;

    // Check if inactive long enough and cooldown has passed
    if (inactiveMinutes >= MEME_IDLE_INACTIVITY_MINUTES && timeSinceLastMeme >= cooldownMs) {
      // Random chance to drop
      return Math.random() < MEME_IDLE_PROBABILITY;
    }

    return false;
  }

  /**
   * Update channel activity state
   */
  updateChannelActivity(channelId: string): void {
    const state = this.channelStates.get(channelId) || {
      lastMessageTime: Date.now(),
      lastMemeDropTime: 0
    };
    state.lastMessageTime = Date.now();
    this.channelStates.set(channelId, state);
  }

  /**
   * Record that a meme was dropped for cooldown tracking
   */
  recordMemeDrop(channelId: string): void {
    const state = this.channelStates.get(channelId);
    if (state) {
      state.lastMemeDropTime = Date.now();
      this.channelStates.set(channelId, state);
    }
  }

  /**
   * Fetch a meme that roughly matches the supplied conversation.
   * Implements fallback strategy: specific category -> broader search -> generic meme
   */
  async fetchMeme(conversationText = '', requestedCategory?: string): Promise<Meme | null> {
    // If specific category requested, try that first
    if (requestedCategory) {
      const categoryMeme = await this.fetchFromCategory(requestedCategory);
      if (categoryMeme) {
        return categoryMeme;
      }
    }

    // Try conversation-based subreddits
    const subreddits = this.getCandidateSubreddits(conversationText);
    const maxAttemptsPerSubreddit = 2;

    for (const subreddit of subreddits) {
      for (let attempt = 0; attempt < maxAttemptsPerSubreddit; attempt++) {
        const meme = await this.fetchFromEndpoint(
          subreddit === 'memes' ? MEME_API_URL : `${MEME_API_URL}/${subreddit}`
        );

        if (meme) {
          return meme;
        }
      }
    }

    // Fallback to generic memes
    for (let attempt = 0; attempt < 3; attempt++) {
      const meme = await this.fetchFromEndpoint(MEME_API_URL);
      if (meme) {
        return meme;
      }
    }

    return null;
  }

  /**
   * Fetch from a specific category/subreddit
   */
  private async fetchFromCategory(category: string): Promise<Meme | null> {
    const subreddit = this.mapCategoryToSubreddit(category);
    if (!subreddit) {
      return null;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const meme = await this.fetchFromEndpoint(`${MEME_API_URL}/${subreddit}`);
      if (meme) {
        return meme;
      }
    }

    return null;
  }

  /**
   * Map user-requested category to subreddit
   */
  private mapCategoryToSubreddit(category: string): string | null {
    const categoryMap: Record<string, string> = {
      'jojo': 'StardustCrusaders',
      'anime': 'animemes',
      'cat': 'catmemes',
      'dog': 'dogmemes',
      'programming': 'ProgrammerHumor',
      'coding': 'ProgrammerHumor',
      'gaming': 'gamingmemes',
      'wholesome': 'wholesomememes',
      'school': 'schoolmemes',
      'work': 'workmemes'
    };

    const normalized = category.toLowerCase();
    return categoryMap[normalized] || null;
  }

  private async fetchFromEndpoint(endpoint: string): Promise<Meme | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MEME_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Meme API error: ${response.status}`);
      }

      const data = (await response.json()) as MemeApiResponse;
      if (!data.url || !data.title || data.nsfw || data.spoiler) {
        return null;
      }

      // Validate URL exists and is accessible
      const isValid = await this.validateImageUrl(data.url);
      if (!isValid) {
        return null;
      }

      return {
        title: data.title,
        imageUrl: data.url,
        postLink: data.postLink,
        subreddit: data.subreddit,
        verified: true
      };
    } catch (error) {
      logger.warn('Failed to fetch meme', {
        endpoint,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate that an image URL is accessible
   */
  private async validateImageUrl(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(url, { 
        method: 'HEAD',
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);

      return response.ok && response.headers.get('content-type')?.startsWith('image/') || false;
    } catch {
      return false;
    }
  }

  private getCandidateSubreddits(conversationText: string): string[] {
    const text = conversationText.toLowerCase();
    const candidates: string[] = [];

    const topicMap: Array<{ subreddit: string; words: string[] }> = [
      { subreddit: 'catmemes', words: ['cat', 'kitty', 'kitten', 'meow'] },
      { subreddit: 'dogmemes', words: ['dog', 'puppy', 'pup', 'woof'] },
      { subreddit: 'animemes', words: ['anime', 'manga', 'waifu', 'otaku'] },
      { subreddit: 'ProgrammerHumor', words: ['code', 'coding', 'program', 'programming', 'developer', 'bug', 'javascript', 'typescript', 'python'] },
      { subreddit: 'gamingmemes', words: ['game', 'gaming', 'gamer', 'minecraft', 'valorant', 'fortnite', 'steam', 'xbox', 'playstation'] },
      { subreddit: 'wholesomememes', words: ['hug', 'cute', 'wholesome', 'happy', 'love', 'friend'] },
      { subreddit: 'schoolmemes', words: ['school', 'homework', 'exam', 'class', 'teacher', 'college'] },
      { subreddit: 'workmemes', words: ['work', 'job', 'boss', 'office', 'shift'] }
    ];

    for (const topic of topicMap) {
      if (topic.words.some(word => this.containsWord(text, word))) {
        candidates.push(topic.subreddit);
      }
    }

    candidates.push('memes');
    candidates.push('dankmemes');

    return [...new Set(candidates)];
  }

  private containsWord(text: string, word: string): boolean {
    return new RegExp(`\\b${word}\\b`, 'i').test(text);
  }

  clearAll(): void {
    this.channelStates.clear();
  }
}

export const memeService = new MemeService();
