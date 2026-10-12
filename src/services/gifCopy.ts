/**
 * GIF library + copycat.
 *
 * Three jobs, none of which use the AI (so no tokens, no Groq rate limit):
 *  1. COLLECT: every GIF people post is remembered (link + keywords read from the link and from
 *     what was said around it; never who posted it and never the message text itself).
 *  2. COPYCAT: once in a while the bot posts the same GIF someone just posted.
 *  3. REUSE: when the bot is about to reply and may add a GIF, it picks a remembered GIF whose
 *     meaning fits what the bot is saying, so a person's GIF makes sense as the bot's own.
 *
 * Everything the bot posts is checked against the shared recent-media memory, so the same GIF is
 * never posted twice in a row.
 */

import type { Message } from 'discord.js';
import {
  GIF_COPY_ENABLED,
  GIF_COPY_CHANCE,
  GIF_COPY_CHANNEL_COOLDOWN_MS,
  GIF_COPY_USER_COOLDOWN_MS,
  GIF_COPY_DELAY_MIN_MS,
  GIF_COPY_DELAY_MAX_MS,
  GIF_LIBRARY_ENABLED,
  GIF_LIBRARY_MAX_PER_GUILD,
  GIF_LIBRARY_MIN_MATCH_SCORE
} from '../config';
import { query } from '../database/pool';
import { logger } from '../utils/logger';
import { randomDelayMs, sleep } from '../utils/discordMedia';
import {
  ExtractedGif,
  contentWords,
  extractGifFromMessage,
  scoreGif
} from './gifContext';
import { normalizeMediaKey, recentMedia, RecentMediaTracker } from './recentMedia';
import { featureToggleService } from './featureToggle';

export interface GifEntry {
  url: string;
  key: string;
  slug: string[];
  context: string[];
  timesSeen: number;
  timesUsed: number;
  lastUsedAt: number | null;
  updatedAt: number;
}

/** Where entries are kept between restarts. The default is the bot's PostgreSQL database. */
export interface GifStore {
  load(guildId: string, limit: number): Promise<GifEntry[]>;
  save(guildId: string, entry: GifEntry): Promise<void>;
  prune(guildId: string, keep: number): Promise<void>;
}

const MAX_CONTEXT_WORDS = 12;

interface GifRow {
  url: string;
  url_key: string;
  slug_words: string[];
  context_words: string[];
  times_seen: number;
  times_used: number;
  last_used_at: Date | null;
  updated_at: Date;
}

export class PgGifStore implements GifStore {
  async load(guildId: string, limit: number): Promise<GifEntry[]> {
    const { rows } = await query<GifRow & Record<string, unknown>>(
      `SELECT url, url_key, slug_words, context_words, times_seen, times_used, last_used_at, updated_at
         FROM gif_library WHERE guild_id = $1 ORDER BY updated_at DESC LIMIT $2`,
      [guildId, limit]
    );
    return rows.map(row => ({
      url: row.url,
      key: row.url_key,
      slug: row.slug_words ?? [],
      context: row.context_words ?? [],
      timesSeen: row.times_seen,
      timesUsed: row.times_used,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : null,
      updatedAt: new Date(row.updated_at).getTime()
    }));
  }

  async save(guildId: string, entry: GifEntry): Promise<void> {
    await query(
      `INSERT INTO gif_library (guild_id, url, url_key, slug_words, context_words, times_seen, times_used, last_used_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (guild_id, url_key) DO UPDATE SET
            url = EXCLUDED.url,
            slug_words = EXCLUDED.slug_words,
            context_words = EXCLUDED.context_words,
            times_seen = EXCLUDED.times_seen,
            times_used = EXCLUDED.times_used,
            last_used_at = EXCLUDED.last_used_at`,
      [
        guildId,
        entry.url,
        entry.key,
        entry.slug,
        entry.context,
        entry.timesSeen,
        entry.timesUsed,
        entry.lastUsedAt ? new Date(entry.lastUsedAt) : null
      ]
    );
  }

  async prune(guildId: string, keep: number): Promise<void> {
    await query(
      `DELETE FROM gif_library WHERE id IN (
         SELECT id FROM gif_library WHERE guild_id = $1 ORDER BY updated_at DESC OFFSET $2
       )`,
      [guildId, keep]
    );
  }
}

/** The remembered GIFs of each server. Memory is the working copy; the store keeps it across restarts. */
export class GifLibrary {
  private guilds: Map<string, Map<string, GifEntry>> = new Map();
  private loading: Map<string, Promise<void>> = new Map();
  private saveCounts: Map<string, number> = new Map();
  private storeDisabledUntil = 0;
  private warnedStoreProblem = false;

  constructor(
    private readonly store: GifStore | null = null,
    private readonly maxPerGuild: number = GIF_LIBRARY_MAX_PER_GUILD,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Make sure a server's saved GIFs are loaded (once). */
  private async ensureLoaded(guildId: string): Promise<Map<string, GifEntry>> {
    let entries = this.guilds.get(guildId);
    if (!entries) {
      entries = new Map();
      this.guilds.set(guildId, entries);
    }

    if (this.store && !this.loading.has(guildId)) {
      const promise = this.guardStore(async () => {
        const saved = await this.store!.load(guildId, this.maxPerGuild);
        for (const entry of saved) {
          if (!entries!.has(entry.key)) entries!.set(entry.key, entry);
        }
      });
      this.loading.set(guildId, promise);
    }
    await this.loading.get(guildId);
    return entries;
  }

  /** Run a store call; if the database is unavailable, keep working from memory. */
  private async guardStore(action: () => Promise<void>): Promise<void> {
    if (!this.store || this.now() < this.storeDisabledUntil) return;
    try {
      await action();
    } catch (error) {
      this.storeDisabledUntil = this.now() + 5 * 60 * 1000; // don't hammer a broken table
      if (!this.warnedStoreProblem) {
        this.warnedStoreProblem = true;
        logger.warn(
          'GIF library: could not use the database (did you run migrations/006_gif_library.sql?). ' +
          'Continuing with GIFs remembered in memory only until the next restart.',
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }
  }

  /** Remember a GIF (or refresh one we already know). Only GIFs that stay reachable are kept. */
  async remember(guildId: string, gif: ExtractedGif, contextWords: string[]): Promise<void> {
    if (!gif.persistent) return;

    const entries = await this.ensureLoaded(guildId);
    const key = normalizeMediaKey(gif.url);
    const existing = entries.get(key);

    const entry: GifEntry = existing ?? {
      url: gif.url,
      key,
      slug: [],
      context: [],
      timesSeen: 0,
      timesUsed: 0,
      lastUsedAt: null,
      updatedAt: this.now()
    };

    entry.url = gif.url;
    entry.timesSeen += 1;
    entry.updatedAt = this.now();
    entry.slug = [...new Set([...entry.slug, ...gif.slugWords])].slice(0, 12);
    entry.context = [...new Set([...entry.context, ...contextWords])].slice(0, MAX_CONTEXT_WORDS);

    // Re-insert so the newest entries sit at the end of the map
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > this.maxPerGuild) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }

    void this.guardStore(async () => {
      await this.store!.save(guildId, entry);
      const count = (this.saveCounts.get(guildId) ?? 0) + 1;
      this.saveCounts.set(guildId, count);
      if (count % 20 === 0) {
        await this.store!.prune(guildId, this.maxPerGuild);
      }
    });
  }

  /** The bot posted this GIF: remember that (for statistics and so favourites are not overused). */
  async markUsed(guildId: string, url: string): Promise<void> {
    const entries = await this.ensureLoaded(guildId);
    const entry = entries.get(normalizeMediaKey(url));
    if (!entry) return;
    entry.timesUsed += 1;
    entry.lastUsedAt = this.now();
    void this.guardStore(async () => this.store!.save(guildId, entry));
  }

  async all(guildId: string): Promise<GifEntry[]> {
    const entries = await this.ensureLoaded(guildId);
    return [...entries.values()];
  }

  size(guildId: string): number {
    return this.guilds.get(guildId)?.size ?? 0;
  }

  clear(): void {
    this.guilds.clear();
    this.loading.clear();
    this.saveCounts.clear();
  }
}

/** What the bot knows about the moment a GIF was posted. */
export interface GifMoment {
  guildId: string;
  channelId: string;
  userId: string;
  gif: ExtractedGif | null;
  /** What the person typed with the GIF (link removed) */
  text: string;
  /** The bot was spoken to in this message: the normal reply flow handles it, so no copycat. */
  isAddressingBot: boolean;
}

export class GifCopyService {
  private lastCopyByChannel: Map<string, number> = new Map();
  private lastCopyByUser: Map<string, number> = new Map();
  private lastTextByChannel: Map<string, { words: string[]; at: number }> = new Map();
  private readonly MAX_TRACKED = 2000;
  private readonly CONTEXT_MAX_AGE_MS = 2 * 60 * 1000;

  constructor(
    readonly library: GifLibrary,
    private readonly media: RecentMediaTracker = recentMedia,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = () => Math.random()
  ) {}

  private scope(guildId: string): string {
    return `gif:${guildId}`;
  }

  /** Remember what was just said in a channel, as a weak hint for the GIF that may come next. */
  noteText(channelId: string, text: string): void {
    const words = contentWords(text);
    if (words.length === 0) return;
    this.lastTextByChannel.delete(channelId);
    this.lastTextByChannel.set(channelId, { words, at: this.now() });
    while (this.lastTextByChannel.size > this.MAX_TRACKED) {
      this.lastTextByChannel.delete(this.lastTextByChannel.keys().next().value as string);
    }
  }

  /** Words from the message right before a GIF (only if it was said recently). */
  private recentContextWords(channelId: string): string[] {
    const last = this.lastTextByChannel.get(channelId);
    if (!last || this.now() - last.at > this.CONTEXT_MAX_AGE_MS) return [];
    return last.words;
  }

  /**
   * Collect + (maybe) copy. Returns whether the bot should copy this GIF now, after waiting a
   * human-looking delay. All the cheap, synchronous rules live here so they are easy to test.
   */
  async process(moment: GifMoment): Promise<{ copy: boolean; reason: string }> {
    const { guildId, channelId, userId, gif } = moment;

    // Words typed with the GIF count more than the message before it
    const typedWords = contentWords(moment.text);
    const previousWords = this.recentContextWords(channelId);
    this.noteText(channelId, moment.text);

    if (!gif) {
      return { copy: false, reason: 'no gif' };
    }

    if (GIF_LIBRARY_ENABLED) {
      const hints = [...new Set([...typedWords, ...previousWords])].slice(0, 12);
      await this.library.remember(guildId, gif, hints);
    }

    if (!GIF_COPY_ENABLED) return { copy: false, reason: 'copycat disabled' };
    if (moment.isAddressingBot) return { copy: false, reason: 'bot was addressed' };
    if (this.media.has(this.scope(guildId), gif.url)) return { copy: false, reason: 'posted recently' };

    const now = this.now();
    if (now - (this.lastCopyByChannel.get(channelId) ?? -Infinity) < GIF_COPY_CHANNEL_COOLDOWN_MS) {
      return { copy: false, reason: 'channel cooldown' };
    }
    if (now - (this.lastCopyByUser.get(`${guildId}:${userId}`) ?? -Infinity) < GIF_COPY_USER_COOLDOWN_MS) {
      return { copy: false, reason: 'user cooldown' };
    }
    if (this.random() >= GIF_COPY_CHANCE) {
      return { copy: false, reason: 'chance' };
    }

    return { copy: true, reason: 'copy' };
  }

  /** The bot is posting this GIF: block repeats and start the cooldowns. */
  recordPosted(guildId: string, channelId: string, userId: string | null, url: string, copied: boolean): void {
    this.media.add(this.scope(guildId), url);
    void this.library.markUsed(guildId, url);

    if (copied) {
      const now = this.now();
      this.lastCopyByChannel.set(channelId, now);
      if (userId) this.lastCopyByUser.set(`${guildId}:${userId}`, now);
      for (const map of [this.lastCopyByChannel, this.lastCopyByUser]) {
        while (map.size > this.MAX_TRACKED) {
          map.delete(map.keys().next().value as string);
        }
      }
    }
  }

  /**
   * A remembered GIF that fits what the bot is saying, or null if nothing fits well enough.
   * @param texts the bot's own reply first, then (optionally) what the user said
   */
  async pickForReply(guildId: string, texts: string[]): Promise<GifEntry | null> {
    if (!GIF_LIBRARY_ENABLED) return null;

    const queryStems = [...new Set(texts.flatMap(text => contentWords(text)))];
    if (queryStems.length === 0) return null;

    const scope = this.scope(guildId);
    const scored = (await this.library.all(guildId))
      .filter(entry => !this.media.has(scope, entry.url))
      .map(entry => ({
        entry,
        // Slightly prefer GIFs the bot has used less, so favourites don't dominate
        score: scoreGif({ slug: entry.slug, context: entry.context }, queryStems) - Math.min(entry.timesUsed, 3) * 0.1
      }))
      .filter(item => item.score >= GIF_LIBRARY_MIN_MATCH_SCORE)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    // Choose randomly among the near-best matches so the same GIF isn't always the winner
    const nearBest = scored.filter(item => item.score >= scored[0].score - 1);
    return nearBest[Math.floor(this.random() * nearBest.length)].entry;
  }

  /**
   * Router entry point for every human message that passed the bot's usual checks.
   * Collects the GIF and, now and then, posts the same one. Never throws.
   */
  async handleMessage(message: Message, isAddressingBot: boolean): Promise<void> {
    try {
      if (!message.guild) return;
      const guildId = message.guild.id;

      const gif = extractGifFromMessage({
        content: message.content ?? '',
        attachments: [...message.attachments.values()].map(a => ({ url: a.url, name: a.name, contentType: a.contentType })),
        embeds: message.embeds.map(e => ({ type: e.data?.type ?? null, url: e.url ?? null }))
      });

      // Plain text still feeds the "message before a GIF" hint
      if (!gif) {
        this.noteText(message.channelId, message.content ?? '');
        return;
      }

      if (!(await featureToggleService.isEnabled(guildId, 'gif'))) return;

      const textWithoutLinks = (message.content ?? '').replace(/https?:\/\/\S+/gi, ' ');
      const decision = await this.process({
        guildId,
        channelId: message.channelId,
        userId: message.author.id,
        gif,
        text: textWithoutLinks,
        isAddressingBot
      });

      if (!decision.copy) {
        logger.debug('[gif-copy] not copying', { reason: decision.reason, channelId: message.channelId });
        return;
      }

      // Never in age-restricted channels
      const channel = message.channel;
      if ('nsfw' in channel && channel.nsfw) return;
      if (!channel.isSendable()) return;

      // Wait like a person would, then make sure the original message is still there
      await sleep(randomDelayMs(GIF_COPY_DELAY_MIN_MS, GIF_COPY_DELAY_MAX_MS, this.random));
      try {
        await channel.messages.fetch(message.id);
      } catch {
        return; // deleted in the meantime
      }

      await channel.send({ content: gif.url, allowedMentions: { parse: [] } });
      this.recordPosted(guildId, message.channelId, message.author.id, gif.url, true);
      logger.info('[gif-copy] copied a GIF', { guildId, channelId: message.channelId, source: gif.source });
    } catch (error) {
      logger.warn('[gif-copy] failed, ignoring', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  clear(): void {
    this.lastCopyByChannel.clear();
    this.lastCopyByUser.clear();
    this.lastTextByChannel.clear();
    this.library.clear();
  }
}

export const gifLibrary = new GifLibrary(GIF_LIBRARY_ENABLED ? new PgGifStore() : null);
export const gifCopyService = new GifCopyService(gifLibrary);
