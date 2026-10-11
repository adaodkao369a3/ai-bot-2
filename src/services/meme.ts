/**
 * Meme service for Bocchi.
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
  lastMemeReplyTime: number;
  conversationStartTime: number;
  awaitingReply: boolean;
  lastConversationTime: number;
}

export class MemeService {
  private channelStates: Map<string, ChannelIdleState> = new Map();
  private usedMemeUrls: Map<string, Set<string>> = new Map(); // channelId -> set of used meme URLs

  /**
   * Check if a meme should be dropped based on inactivity
   * - Only drop memes when the channel is dead (inactive for at least 15 minutes)
   * - If no reply to the last meme, stop dropping until someone talks again
   * - Only drop memes after 15 minutes of inactivity
   */
  shouldDropIdleMeme(channelId: string): boolean {
    if (!MEME_IDLE_ENABLED) {
      return false;
    }

    const now = Date.now();
    const state = this.channelStates.get(channelId);

    // Only consider channels that have been initialized through activity
    if (!state) {
      return false;
    }

    const fifteenMinutes = 15 * 60 * 1000;
    const thirtyMinutes = 30 * 60 * 1000;
    const timeSinceLastMeme = now - state.lastMemeDropTime;
    const timeSinceLastMessage = now - state.lastMessageTime;

    // If we're waiting for a reply, don't drop more memes
    if (state.awaitingReply) {
      // If it's been more than 30 minutes with no reply, reset the state
      if (timeSinceLastMeme > thirtyMinutes) {
        state.awaitingReply = false;
        this.channelStates.set(channelId, state);
        return false;
      }
      return false;
    }

    // Only drop memes if the channel has been inactive for at least 15 minutes
    if (timeSinceLastMessage >= fifteenMinutes) {
      // Also ensure at least 15 minutes since last meme drop
      if (timeSinceLastMeme >= fifteenMinutes) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update channel activity state and mark that we got a reply
   */
  updateChannelActivity(channelId: string): void {
    const state = this.channelStates.get(channelId) || {
      lastMessageTime: Date.now(),
      lastMemeDropTime: 0,
      lastMemeReplyTime: 0,
      conversationStartTime: Date.now(),
      awaitingReply: false,
      lastConversationTime: Date.now()
    };
    state.lastMessageTime = Date.now();
    state.lastConversationTime = Date.now();
    state.awaitingReply = false; // We got a reply, so we can drop memes again
    this.channelStates.set(channelId, state);
  }



  /**
   * Record that a meme was dropped for cooldown tracking
   */
  recordMemeDrop(channelId: string): void {
    const state = this.channelStates.get(channelId);
    if (state) {
      state.lastMemeDropTime = Date.now();
      state.awaitingReply = true; // Now we wait for a reply
      this.channelStates.set(channelId, state);
    }
  }

  /**
   * Fetch a meme that roughly matches the supplied conversation.
   * Implements fallback strategy: specific category -> broader search -> generic meme
   * Also ensures the meme hasn't been used recently in this channel
   */
  async fetchMeme(conversationText = '', requestedCategory?: string, channelId?: string): Promise<Meme | null> {
    const usedMemes = channelId ? (this.usedMemeUrls.get(channelId) || new Set()) : new Set();

    // If specific category requested, try that first with more attempts
    if (requestedCategory) {
      const categoryMeme = await this.fetchFromCategory(requestedCategory, usedMemes);
      if (categoryMeme) {
        this.trackUsedMeme(channelId, categoryMeme.imageUrl);
        return categoryMeme;
      }

      // Try related subreddits if the specific category fails
      const relatedSubreddits = this.getRelatedSubreddits(requestedCategory);
      for (const subreddit of relatedSubreddits) {
        const meme = await this.fetchFromEndpoint(`${MEME_API_URL}/${subreddit}`, usedMemes);
        if (meme) {
          this.trackUsedMeme(channelId, meme.imageUrl);
          return meme;
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
          usedMemes
        );

        if (meme) {
          this.trackUsedMeme(channelId, meme.imageUrl);
          return meme;
        }
      }
    }

    // Fallback to generic memes only if all else fails
    for (let attempt = 0; attempt < 2; attempt++) {
      const meme = await this.fetchFromEndpoint(MEME_API_URL, usedMemes);
      if (meme) {
        this.trackUsedMeme(channelId, meme.imageUrl);
        return meme;
      }
    }

    return null;
  }

  /**
   * Track a meme as used in a channel
   */
  private trackUsedMeme(channelId: string | undefined, memeUrl: string): void {
    if (!channelId) return;

    if (!this.usedMemeUrls.has(channelId)) {
      this.usedMemeUrls.set(channelId, new Set());
    }

    const channelMemes = this.usedMemeUrls.get(channelId)!;
    channelMemes.add(memeUrl);

    // Limit the set size to prevent memory issues (keep last 100)
    if (channelMemes.size > 100) {
      const firstItem = channelMemes.values().next().value;
      channelMemes.delete(firstItem);
    }
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
  private async fetchFromCategory(category: string, usedMemes: Set<string>): Promise<Meme | null> {
    const subreddit = this.mapCategoryToSubreddit(category);
    if (!subreddit) {
      return null;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const meme = await this.fetchFromEndpoint(`${MEME_API_URL}/${subreddit}`, usedMemes);
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

  private async fetchFromEndpoint(endpoint: string, usedMemes: Set<string> = new Set()): Promise<Meme | null> {
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

      // Check if this meme has already been used
      if (usedMemes.has(data.url)) {
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
    this.channelStates.clear();
  }
}

export const memeService = new MemeService();
