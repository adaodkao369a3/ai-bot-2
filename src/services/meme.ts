/**
 * Meme service for Bot Kun.
 * Tracks seven addressed chat exchanges and fetches a real meme from the
 * meme API. The subreddit is selected from the recent conversation so the
 * result is at least topically related instead of always being random.
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
   * Fetch a meme that roughly matches the supplied conversation.
   *
   * meme-api.com supports subreddit-specific requests, so we use simple,
   * deterministic topic routing rather than pretending a random meme is
   * semantically relevant.
   */
  async fetchMeme(conversationText = ''): Promise<Meme | null> {
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

    return null;
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

      return {
        title: data.title,
        imageUrl: data.url,
        postLink: data.postLink,
        subreddit: data.subreddit
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
    this.state.clear();
  }
}

export const memeService = new MemeService();
