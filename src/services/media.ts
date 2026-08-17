/**
 * Rich media service for Bot Kun.
 *
 * Explicit media requests are handled here instead of asking the chat model to
 * invent links. Discord gets either a real GIF embed or a real YouTube watch
 * URL, which Discord can render as a native video player.
 */

import { env } from '../utils/env';
import { logger } from '../utils/logger';

export interface GifResult {
  url: string;
  title?: string;
}

export interface YoutubeResult {
  videoId: string;
  title: string;
}

interface KlipyResult {
  media_formats?: {
    gif?: { url?: string };
    mediumgif?: { url?: string };
    tinygif?: { url?: string };
  };
  url?: string;
  title?: string;
}

interface KlipyResponse {
  results?: KlipyResult[];
}

interface YoutubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: { title?: string };
  }>;
}

export class MediaService {
  private readonly klipyTimeoutMs = 8000;
  private readonly youtubeTimeoutMs = 8000;

  async searchGif(query: string): Promise<GifResult | null> {
    const key = env.KLIPY_KEY;
    if (!key) {
      logger.warn('GIF request skipped: KLIPY_KEY is not configured');
      return null;
    }

    const params = new URLSearchParams({
      q: query,
      key,
      client_key: 'bot-kun',
      limit: '10',
      media_filter: 'gif'
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.klipyTimeoutMs);

    try {
      const response = await fetch(`https://api.klipy.com/v2/search?${params.toString()}`, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`KLIPY API error: ${response.status}`);
      }

      const data = (await response.json()) as KlipyResponse;
      const result = data.results?.find(item => this.extractGifUrl(item));

      if (!result) {
        return null;
      }

      const url = this.extractGifUrl(result);
      if (!url) {
        return null;
      }

      return {
        url,
        title: result.title
      };
    } catch (error) {
      logger.warn('Failed to fetch GIF from KLIPY', {
        query,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async searchYoutube(query: string): Promise<YoutubeResult | null> {
    const key = env.YOUTUBE_API_KEY;
    if (!key) {
      logger.warn('YouTube request skipped: YOUTUBE_API_KEY is not configured');
      return null;
    }

    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '1',
      safeSearch: 'moderate',
      key
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.youtubeTimeoutMs);

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
        { signal: controller.signal }
      );

      if (!response.ok) {
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = (await response.json()) as YoutubeSearchResponse;
      const item = data.items?.find(candidate => candidate.id?.videoId);

      if (!item?.id?.videoId) {
        return null;
      }

      return {
        videoId: item.id.videoId,
        title: item.snippet?.title ?? query
      };
    } catch (error) {
      logger.warn('Failed to search YouTube', {
        query,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractGifUrl(result: KlipyResult): string | null {
    return result.media_formats?.gif?.url
      ?? result.media_formats?.mediumgif?.url
      ?? result.media_formats?.tinygif?.url
      ?? result.url
      ?? null;
  }
}

export const mediaService = new MediaService();
