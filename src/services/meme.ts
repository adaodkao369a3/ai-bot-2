/**
 * Meme service for Bocchi.
 * Fetches real memes from the meme API with validation and fallback, never repeating a meme
 * that was posted recently, and decides when an "idle meme" should be dropped.
 *
 * Idle meme rules (the whole point of the "session" below):
 *  - A session starts when someone CALLS the bot in a channel (one session per server: the
 *    channel where the bot was called last).
 *  - Once that channel has been quiet for ~5 minutes (+ a little random extra) the bot may
 *    drop ONE meme in that channel.
 *  - After the drop the session is finished. No more memes until someone calls the bot again.
 *  - Channels where nobody called the bot never get memes, no matter how active they are.
 */

import {
  MEME_API_URL,
  MEME_IDLE_ENABLED,
  MEME_IDLE_AFTER_MS,
  MEME_IDLE_JITTER_MS,
  MEME_IDLE_SESSION_MAX_MS,
  MEME_FETCH_TIMEOUT_MS
} from '../config';
import { logger } from '../utils/logger';
import { recentMedia } from './recentMedia';

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

/** One "the bot was called here" session (at most one per server). */
interface IdleSession {
  channelId: string;
  lastCalledAt: number;
  lastActivityAt: number; // last message from anyone in that channel
  quietNeededMs: number; // how long the channel must stay quiet (5 min + jitter)
  dropped: boolean; // true once the one meme for this session has been dropped
}

export interface DueIdleMeme {
  guildId: string;
  channelId: string;
}

export class MemeService {
  // guildId -> the session for the channel where the bot was called last
  private sessions: Map<string, IdleSession> = new Map();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = () => Math.random()
  ) {}

  /**
   * Someone called the bot in this channel. Starts (or restarts) the session for the server:
   * this channel becomes "where the bot was last called" and a new meme is allowed again.
   */
  markBotCalled(guildId: string, channelId: string): void {
    const now = this.now();
    this.sessions.set(guildId, {
      channelId,
      lastCalledAt: now,
      lastActivityAt: now,
      quietNeededMs: MEME_IDLE_AFTER_MS + Math.floor(this.random() * MEME_IDLE_JITTER_MS),
      dropped: false
    });
  }

  /**
   * Any message in a channel. Only counts for the channel of the current session (it keeps the
   * channel "busy"); it NEVER creates a session, so chatting somewhere does not earn a meme.
   */
  noteActivity(guildId: string, channelId: string): void {
    const session = this.sessions.get(guildId);
    if (session && session.channelId === channelId) {
      session.lastActivityAt = this.now();
    }
  }

  /**
   * Sessions whose channel has been quiet long enough for the one idle meme.
   * The caller still has to run its own checks (bot enabled, channel allowed, meme toggle...).
   */
  getDueIdleMemes(): DueIdleMeme[] {
    if (!MEME_IDLE_ENABLED) {
      return [];
    }

    const now = this.now();
    const due: DueIdleMeme[] = [];

    for (const [guildId, session] of this.sessions) {
      if (session.dropped) continue;

      // A call from long ago is stale: forget it instead of dropping a random meme much later
      if (now - session.lastCalledAt > MEME_IDLE_SESSION_MAX_MS) {
        this.sessions.delete(guildId);
        continue;
      }

      if (now - session.lastActivityAt >= session.quietNeededMs) {
        due.push({ guildId, channelId: session.channelId });
      }
    }

    return due;
  }

  /**
   * The idle meme was handled (dropped, or deliberately skipped): finish the session so it can
   * not fire again until the bot is called again.
   */
  finishSession(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (session) {
      session.dropped = true;
    }
  }

  /**
   * Fetch a meme that roughly matches the supplied conversation.
   * Implements fallback strategy: specific category -> broader search -> generic meme.
   * A meme that was posted recently in the same scope (usually the server) is never returned.
   *
   * @param scopeId what "recently posted" is measured in; pass the guild id so the same meme does
   *                not show up in two channels of one server either
   */
  async fetchMeme(conversationText = '', requestedCategory?: string, scopeId?: string): Promise<Meme | null> {
    const scope = `meme:${scopeId ?? 'global'}`;
    const isUsed = (url: string, title?: string): boolean =>
      recentMedia.has(scope, url) || (title !== undefined && recentMedia.has(scope, `title:${title.toLowerCase().trim()}`));

    const finish = (meme: Meme): Meme => {
      recentMedia.add(scope, meme.imageUrl);
      recentMedia.add(scope, `title:${meme.title.toLowerCase().trim()}`);
      return meme;
    };

    // If specific category requested, try that first with more attempts
    if (requestedCategory) {
      const categoryMeme = await this.fetchFromCategory(requestedCategory, isUsed);
      if (categoryMeme) {
        return finish(categoryMeme);
      }

      // Try related subreddits if the specific category fails
      const relatedSubreddits = this.getRelatedSubreddits(requestedCategory);
      for (const subreddit of relatedSubreddits) {
        const meme = await this.fetchFromEndpoint(`${MEME_API_URL}/${subreddit}`, isUsed);
        if (meme) {
          return finish(meme);
        }
      }
    }

    // Try conversation-based subreddits
    const subreddits = this.getCandidateSubreddits(conversationText);
    const maxAttemptsPerSubreddit = 3; // Increased attempts for better topic matching

    for (const subreddit of subreddits) {
      for (let attempt = 0; attempt < maxAttemptsPerSubreddit; attempt++) {
        const meme = await this.fetchFromEndpoint(
          subreddit === 'memes' ? MEME_API_URL : `${MEME_API_URL}/${subreddit}`,
          isUsed
        );

        if (meme) {
          return finish(meme);
        }
      }
    }

    // Fallback to generic memes only if all else fails
    for (let attempt = 0; attempt < 2; attempt++) {
      const meme = await this.fetchFromEndpoint(MEME_API_URL, isUsed);
      if (meme) {
        return finish(meme);
      }
    }

    return null;
  }

  /**
   * Get related subreddits for a category if the direct one fails
   */
  private getRelatedSubreddits(category: string): string[] {
    const normalizedCategory = category.toLowerCase();
    const relatedMap: Record<string, string[]> = {
      'anime': ['animemes', 'StardustCrusaders', 'anime_irl'],
      'cat': ['catmemes', 'cats', 'CatPictures'],
      'dog': ['dogmemes', 'dogs', 'DogPictures'],
      'gaming': ['gamingmemes', 'gaming', 'Games'],
      'programming': ['ProgrammerHumor', 'coding', 'programming'],
      'work': ['workmemes', 'work', 'corporate'],
      'school': ['schoolmemes', 'college', 'education'],
      'music': ['musicmemes', 'music', 'Music'],
      'movies': ['moviememes', 'movies', 'film'],
      'sports': ['sports', 'nba', 'nfl'],
      'tech': ['tech', 'technology', 'gadgets']
    };

    return relatedMap[normalizedCategory] || [];
  }

  /**
   * Fetch from a specific category/subreddit
   */
  private async fetchFromCategory(category: string, isUsed: (url: string, title?: string) => boolean): Promise<Meme | null> {
    const subreddit = this.mapCategoryToSubreddit(category);
    if (!subreddit) {
      return null;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const meme = await this.fetchFromEndpoint(`${MEME_API_URL}/${subreddit}`, isUsed);
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
      'manga': 'animemes',
      'cat': 'catmemes',
      'kitten': 'catmemes',
      'dog': 'dogmemes',
      'puppy': 'dogmemes',
      'programming': 'ProgrammerHumor',
      'coding': 'ProgrammerHumor',
      'code': 'ProgrammerHumor',
      'developer': 'ProgrammerHumor',
      'gaming': 'gamingmemes',
      'games': 'gamingmemes',
      'game': 'gamingmemes',
      'gamer': 'gamingmemes',
      'wholesome': 'wholesomememes',
      'cute': 'wholesomememes',
      'school': 'schoolmemes',
      'college': 'schoolmemes',
      'homework': 'schoolmemes',
      'work': 'workmemes',
      'office': 'workmemes',
      'job': 'workmemes',
      'boss': 'workmemes',
      'minecraft': 'Minecraft',
      'fortnite': 'Fortnite',
      'valorant': 'Valorant',
      'sports': 'sports',
      'football': 'sports',
      'basketball': 'sports',
      'soccer': 'sports',
      'music': 'musicmemes',
      'movies': 'moviememes',
      'film': 'moviememes',
      'tv': 'television',
      'politics': 'PoliticalHumor',
      'science': 'science',
      'math': 'mathmemes',
      'history': 'historymemes',
      'food': 'foodmemes',
      'cooking': 'foodmemes',
      'fitness': 'fitness',
      'gym': 'fitness',
      'cars': 'cars',
      'technology': 'tech',
      'tech': 'tech',
      'phones': 'tech',
      'crypto': 'CryptoCurrency',
      'bitcoin': 'CryptoCurrency',
      'nft': 'NFT',
      'memes': 'memes',
      'dank': 'dankmemes',
      'funny': 'funny',
      'reaction': 'reactiongifs'
    };

    const normalized = category.toLowerCase().trim();
    return categoryMap[normalized] || null;
  }

  private async fetchFromEndpoint(endpoint: string, isUsed: (url: string, title?: string) => boolean = () => false): Promise<Meme | null> {
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

      // Skip memes (or reposts with the same title) that were posted recently
      if (isUsed(data.url, data.title)) {
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
      { subreddit: 'catmemes', words: ['cat', 'kitty', 'kitten', 'meow', 'feline'] },
      { subreddit: 'dogmemes', words: ['dog', 'puppy', 'pup', 'woof', 'canine'] },
      { subreddit: 'animemes', words: ['anime', 'manga', 'waifu', 'otaku', 'naruto', 'one piece', 'dragon ball'] },
      { subreddit: 'ProgrammerHumor', words: ['code', 'coding', 'program', 'programming', 'developer', 'bug', 'javascript', 'typescript', 'python', 'java', 'software', 'api', 'database'] },
      { subreddit: 'gamingmemes', words: ['game', 'gaming', 'gamer', 'minecraft', 'valorant', 'fortnite', 'steam', 'xbox', 'playstation', 'nintendo', 'ps5', 'xbox series'] },
      { subreddit: 'wholesomememes', words: ['hug', 'cute', 'wholesome', 'happy', 'love', 'friend', ' wholesome', ' wholesome meme'] },
      { subreddit: 'schoolmemes', words: ['school', 'homework', 'exam', 'class', 'teacher', 'college', 'university', 'student', 'study'] },
      { subreddit: 'workmemes', words: ['work', 'job', 'boss', 'office', 'shift', 'coworker', 'meeting', 'corporate'] },
      { subreddit: 'Minecraft', words: ['minecraft', 'creeper', 'steve', 'block', 'craft'] },
      { subreddit: 'Fortnite', words: ['fortnite', 'battle royale', 'victory royale', 'epic games'] },
      { subreddit: 'Valorant', words: ['valorant', 'agent', 'riot games', 'ranked'] },
      { subreddit: 'sports', words: ['sport', 'football', 'basketball', 'soccer', 'baseball', 'hockey', 'tennis', 'athlete'] },
      { subreddit: 'musicmemes', words: ['music', 'song', 'artist', 'band', 'concert', 'album', 'spotify', 'soundtrack'] },
      { subreddit: 'moviememes', words: ['movie', 'film', 'cinema', 'actor', 'actress', 'director', 'hollywood', 'netflix'] },
      { subreddit: 'PoliticalHumor', words: ['politics', 'political', 'government', 'election', 'congress', 'president', 'democrat', 'republican'] },
      { subreddit: 'science', words: ['science', 'scientist', 'physics', 'chemistry', 'biology', 'research', 'experiment', 'laboratory'] },
      { subreddit: 'mathmemes', words: ['math', 'mathematics', 'calculus', 'algebra', 'geometry', 'equation', 'formula'] },
      { subreddit: 'historymemes', words: ['history', 'historical', 'ancient', 'medieval', 'war', 'empire', 'civilization'] },
      { subreddit: 'foodmemes', words: ['food', 'cooking', 'recipe', 'chef', 'restaurant', 'eat', 'meal', 'dish'] },
      { subreddit: 'fitness', words: ['fitness', 'gym', 'workout', 'exercise', 'muscle', 'protein', 'cardio', 'lifting'] },
      { subreddit: 'cars', words: ['car', 'vehicle', 'drive', 'driver', 'automotive', 'racing', 'speed', 'engine'] },
      { subreddit: 'tech', words: ['technology', 'tech', 'phone', 'smartphone', 'computer', 'laptop', 'internet', 'app', 'software'] },
      { subreddit: 'CryptoCurrency', words: ['crypto', 'cryptocurrency', 'bitcoin', 'ethereum', 'blockchain', 'trading', 'invest'] },
      { subreddit: 'dankmemes', words: ['dank', 'edgy', 'dark humor', 'offensive'] }
    ];

    for (const topic of topicMap) {
      if (topic.words.some(word => this.containsWord(text, word))) {
        candidates.push(topic.subreddit);
      }
    }

    // Only add generic meme subreddits if no specific topics were found
    if (candidates.length === 0) {
      candidates.push('memes');
      candidates.push('dankmemes');
    }

    return [...new Set(candidates)];
  }

  private containsWord(text: string, word: string): boolean {
    return new RegExp(`\\b${word}\\b`, 'i').test(text);
  }

  clearAll(): void {
    this.sessions.clear();
  }
}

export const memeService = new MemeService();
