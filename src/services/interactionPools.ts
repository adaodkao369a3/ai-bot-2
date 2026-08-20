/**
 * Interaction pools for Bot-Kun
 * Provides randomized text and media responses for affection interactions
 */

import { mediaService, GifResult } from './media';
import { logger } from '../utils/logger';

interface InteractionResponse {
  text: string;
  gif?: GifResult;
}

interface InteractionPool {
  texts: string[];
  searchQueries: string[];
}

export class InteractionPoolsService {
  private recentMedia: Map<string, string[]> = new Map();
  private readonly AVOID_RECENT_COUNT = 3;

  private pools: Record<string, InteractionPool> = {
    hug: {
      texts: [
        'get over here 😭',
        'fineee 🫂',
        'bro really needs affection 💀',
        'come here idiot',
        'okokok',
        'cmonere',
        'you asked for this',
        'fine',
        'whatever',
        '😭'
      ],
      searchQueries: ['hug', 'cuddle', 'warm hug', 'bear hug', 'group hug']
    },
    kiss: {
      texts: [
        'bro wants the premium package 💀',
        'nahhh 😭',
        'you wish',
        'in your dreams',
        '💀',
        'no shot',
        'keep dreaming',
        '😭'
      ],
      searchQueries: ['kiss', 'blow kiss', 'mwah', 'kiss cheek']
    },
    cuddle: {
      texts: [
        'get over here 😭',
        'fineee 🫂',
        'bro really needs affection 💀',
        'come here idiot',
        'cmon',
        'whatever',
        'ok',
        '😭'
      ],
      searchQueries: ['cuddle', 'snuggle', 'cuddle pile', 'cozy']
    },
    headpat: {
      texts: [
        '*pat pat*',
        'good boy',
        'there there',
        '😭',
        'pat pat',
        '*pats*',
        'headpats',
        '💀'
      ],
      searchQueries: ['head pat', 'pet head', 'pats', 'headpats']
    },
    pat: {
      texts: [
        '*pat pat*',
        'good boy',
        'there there',
        '😭',
        'pat pat',
        '*pats*',
        '💀'
      ],
      searchQueries: ['pat', 'head pat', 'pats', 'back pat']
    },
    'high five': {
      texts: [
        '*high five*',
        '👋',
        'up top',
        'nice',
        'yesss',
        '😎',
        '🤝'
      ],
      searchQueries: ['high five', 'highfive', 'slap hand']
    },
    handshake: {
      texts: [
        '*shakes hand*',
        '🤝',
        'deal',
        'nice doing business',
        'solid',
        '😎'
      ],
      searchQueries: ['handshake', 'shake hands', 'firm handshake']
    },
    punch: {
      texts: [
        'take this 💀',
        '*punch*',
        'had it coming',
        '😭',
        'ouch',
        'bam'
      ],
      searchQueries: ['punch', 'hit', 'slap punch']
    },
    kick: {
      texts: [
        'take this 💀',
        '*kick*',
        'had it coming',
        '😭',
        'ouch',
        'bam'
      ],
      searchQueries: ['kick', 'drop kick']
    },
    slap: {
      texts: [
        '*slap*',
        'had it coming',
        '😭',
        'ouch',
        'wow',
        '💀'
      ],
      searchQueries: ['slap', 'face slap']
    },
    wave: {
      texts: [
        '*waves*',
        '👋',
        'hi',
        'hey',
        'yo',
        '😎'
      ],
      searchQueries: ['wave', 'waving', 'hello wave']
    },
    cry: {
      texts: [
        '😭',
        'its ok',
        'there there',
        'dont cry',
        '💀',
        'cmon'
      ],
      searchQueries: ['crying', 'sad cry', 'tears']
    },
    laugh: {
      texts: [
        '😂',
        'lmao',
        '😭',
        '💀',
        'lol',
        'funny'
      ],
      searchQueries: ['laughing', 'lol', 'haha']
    },
    dance: {
      texts: [
        '*dances*',
        '💃',
        '🕺',
        'lets go',
        'party time',
        '😎'
      ],
      searchQueries: ['dance', 'dancing', 'party dance']
    }
  };

  /**
   * Get a randomized interaction response with media
   */
  async getInteractionResponse(interaction: string): Promise<InteractionResponse | null> {
    const pool = this.pools[interaction];
    if (!pool) {
      logger.warn(`Unknown interaction type: ${interaction}`);
      return null;
    }

    // Select random text
    const text = pool.texts[Math.floor(Math.random() * pool.texts.length)];

    // Get GIF that hasn't been used recently
    const gif = await this.getRandomGif(interaction, pool.searchQueries);
    
    return { text, gif };
  }

  /**
   * Get a random GIF avoiding recently used ones
   */
  private async getRandomGif(interaction: string, searchQueries: string[]): Promise<GifResult | undefined> {
    const recent = this.recentMedia.get(interaction) || [];
    
    // Try each search query until we find a GIF not in recent
    for (const query of searchQueries) {
      const gif = await mediaService.searchGif(query);
      if (gif && !recent.includes(gif.url)) {
        // Add to recent and maintain size limit
        recent.push(gif.url);
        if (recent.length > this.AVOID_RECENT_COUNT) {
          recent.shift();
        }
        this.recentMedia.set(interaction, recent);
        return gif;
      }
    }

    // Fallback: if all recent, just return whatever we got
    for (const query of searchQueries) {
      const gif = await mediaService.searchGif(query);
      if (gif) {
        return gif;
      }
    }

    return undefined;
  }

  /**
   * Check if a string is a valid interaction type
   */
  isValidInteraction(interaction: string): boolean {
    return interaction in this.pools;
  }

  /**
   * Get all available interaction types
   */
  getInteractionTypes(): string[] {
    return Object.keys(this.pools);
  }

  /**
   * Clear recent media history (useful for testing)
   */
  clearRecentMedia(): void {
    this.recentMedia.clear();
  }
}

export const interactionPoolsService = new InteractionPoolsService();
