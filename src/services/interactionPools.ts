/**
 * Interaction pools
 * Provides randomized text and media responses for affection interactions
 */

import { mediaService, GifResult } from './media';
import { logger } from '../utils/logger';
import { variety } from './variety';
import { recentMedia as sharedRecentMedia } from './recentMedia';

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
  async getInteractionResponse(interaction: string, guildId?: string): Promise<InteractionResponse | null> {
    const pool = this.pools[interaction];
    if (!pool) {
      logger.warn(`Unknown interaction type: ${interaction}`);
      return null;
    }

    // Pick a text that was not used the last few times for this interaction
    const text = variety.pick(`interaction:${interaction}`, pool.texts);

    // Get GIF that hasn't been used recently
    const gif = await this.getRandomGif(interaction, pool.searchQueries, guildId);

    return { text, gif };
  }

  /**
   * Get a random GIF that was not posted recently (in this interaction or, when the server is
   * known, anywhere by the bot in that server). If every result is a repeat, no GIF is sent:
   * a reply without a GIF is better than the same GIF again.
   */
  private async getRandomGif(interaction: string, searchQueries: string[], guildId?: string): Promise<GifResult | undefined> {
    const recent = this.recentMedia.get(interaction) || [];
    const scope = guildId ? `gif:${guildId}` : null;
    const isUsed = (url: string) => recent.includes(url) || (scope !== null && sharedRecentMedia.has(scope, url));

    for (const query of searchQueries) {
      const gif = await mediaService.searchGif(query, isUsed);
      if (gif) {
        recent.push(gif.url);
        if (recent.length > this.AVOID_RECENT_COUNT) {
          recent.shift();
        }
        this.recentMedia.set(interaction, recent);
        if (scope) sharedRecentMedia.add(scope, gif.url);
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
