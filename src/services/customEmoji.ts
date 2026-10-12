/**
 * Server custom emojis in the bot's replies: used now and then, never spammed, never repeated.
 *
 * How it works (cheap on AI tokens):
 *  1. offer(): for SOME replies only (a random chance, and never twice in a row) the AI is shown a
 *     few of the server's emoji names and told it may use at most one, written like :name:.
 *     Emojis used recently are not offered, so the bot rotates through the whole set.
 *  2. process(): after the AI answers, THIS code (not the AI) turns :name: into the real emoji,
 *     removes anything that was not offered (made-up or copied from chat), enforces the limits
 *     (1 custom emoji, 2 emojis in total) and removes normal emojis that the bot used in its last
 *     few replies in that channel.
 */

import {
  CUSTOM_EMOJI_ENABLED,
  CUSTOM_EMOJI_OFFER_CHANCE,
  CUSTOM_EMOJI_MIN_REPLY_GAP,
  CUSTOM_EMOJI_OFFER_COUNT,
  CUSTOM_EMOJI_MAX_PER_REPLY,
  CUSTOM_EMOJI_NO_REPEAT_COUNT,
  CUSTOM_EMOJI_REUSE_COOLDOWN_MS,
  UNICODE_EMOJI_REPEAT_WINDOW,
  MAX_EMOJI_PER_REPLY
} from '../config';

export interface GuildEmoji {
  id: string;
  name: string;
  animated: boolean;
}

export interface EmojiOffer {
  emojis: GuildEmoji[];
  /** The short instruction block that is sent to the AI. */
  promptText: string;
}

export interface ProcessedReply {
  text: string;
  usedCustom: GuildEmoji | null;
}

const CUSTOM_TOKEN = /<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>/g;
const SHORTCODE = /:([A-Za-z0-9_]{2,32}):/g;
const UNICODE_EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

/** `<:kekw:123456789012345678>` -> `:kekw:` (used before storing replies as chat context, to save tokens). */
export function toShortcodes(text: string): string {
  return text.replace(CUSTOM_TOKEN, (_m, _a, name) => `:${name}:`);
}

export class CustomEmojiService {
  // guildId -> custom emojis the bot used, oldest first
  private usedByGuild: Map<string, Array<{ id: string; at: number }>> = new Map();
  // channelId -> bot replies since the last custom emoji (starts "high": the first reply may have one)
  private repliesSinceCustom: Map<string, number> = new Map();
  // channelId -> normal emojis used in the bot's last few replies, oldest first
  private recentUnicode: Map<string, string[][]> = new Map();
  private readonly MAX_TRACKED = 1000;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = () => Math.random()
  ) {}

  /** Decide whether THIS reply may use a custom emoji and which ones to show the AI. */
  offer(guildId: string, channelId: string, available: GuildEmoji[]): EmojiOffer | null {
    if (!CUSTOM_EMOJI_ENABLED || available.length === 0) return null;

    const sinceLast = this.repliesSinceCustom.get(channelId) ?? Number.MAX_SAFE_INTEGER;
    if (sinceLast < CUSTOM_EMOJI_MIN_REPLY_GAP) return null;
    if (this.random() >= CUSTOM_EMOJI_OFFER_CHANCE) return null;

    // Skip emojis used recently: among the last N uses in this server, or within the cooldown time
    const history = this.usedByGuild.get(guildId) ?? [];
    const now = this.now();
    const blocked = new Set<string>();
    for (const use of history.slice(-CUSTOM_EMOJI_NO_REPEAT_COUNT)) blocked.add(use.id);
    for (const use of history) {
      if (now - use.at < CUSTOM_EMOJI_REUSE_COOLDOWN_MS) blocked.add(use.id);
    }

    const candidates = available.filter(emoji => !blocked.has(emoji.id));
    if (candidates.length === 0) return null;

    // Shuffle (Fisher-Yates) and take a handful
    const pool = [...candidates];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const emojis = pool.slice(0, CUSTOM_EMOJI_OFFER_COUNT);

    return {
      emojis,
      promptText:
        'Server custom emojis you MAY use (optional: at most one, only if it clearly fits the moment, ' +
        'otherwise none; write it exactly like :name:): ' +
        emojis.map(emoji => `:${emoji.name}:`).join(' ')
    };
  }

  /** Clean up the AI's reply and record what was used. */
  process(reply: string, channelId: string, guildId: string, offer: EmojiOffer | null): ProcessedReply {
    const offeredByName = new Map<string, GuildEmoji>();
    const offeredById = new Map<string, GuildEmoji>();
    for (const emoji of offer?.emojis ?? []) {
      offeredByName.set(emoji.name, emoji);
      offeredById.set(emoji.id, emoji);
    }

    // 1. :name: -> real emoji, but only for emojis that were offered
    let text = reply.replace(SHORTCODE, (match, name: string) => {
      const emoji = offeredByName.get(name);
      return emoji ? this.format(emoji) : match;
    });

    // 2. Full <:name:id> tokens: keep only offered ones, and only the first custom emoji overall
    let usedCustom: GuildEmoji | null = null;
    text = text.replace(CUSTOM_TOKEN, (_match, _animated, _name, id: string) => {
      const emoji = offeredById.get(id);
      if (!emoji || usedCustom || CUSTOM_EMOJI_MAX_PER_REPLY < 1) return '';
      usedCustom = emoji;
      return this.format(emoji);
    });

    // 3. Normal emojis: drop ones used in the bot's last few replies here, and duplicates
    const recent = new Set((this.recentUnicode.get(channelId) ?? []).flat());
    const seenNow = new Set<string>();
    text = text.replace(UNICODE_EMOJI, emoji => {
      if (recent.has(emoji) || seenNow.has(emoji)) return '';
      seenNow.add(emoji);
      return emoji;
    });

    // 4. At most MAX_EMOJI_PER_REPLY emojis in total (custom + normal), keeping the first ones
    let kept = 0;
    text = text.replace(new RegExp(`${CUSTOM_TOKEN.source}|${UNICODE_EMOJI.source}`, 'gu'), token => {
      kept += 1;
      return kept > MAX_EMOJI_PER_REPLY ? '' : token;
    });

    text = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').replace(/[ \t]+\n/g, '\n').trim();

    // An emoji-only reply that got stripped entirely: better to repeat than to send nothing
    if (!text) {
      text = reply;
      usedCustom = null;
    }

    this.record(channelId, guildId, text, usedCustom);
    return { text, usedCustom };
  }

  private format(emoji: GuildEmoji): string {
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  }

  private record(channelId: string, guildId: string, finalText: string, usedCustom: GuildEmoji | null): void {
    const unicode = [...finalText.replace(CUSTOM_TOKEN, ' ').matchAll(UNICODE_EMOJI)].map(m => m[0]);
    const list = this.recentUnicode.get(channelId) ?? [];
    list.push(unicode);
    while (list.length > UNICODE_EMOJI_REPEAT_WINDOW) list.shift();
    this.recentUnicode.delete(channelId);
    this.recentUnicode.set(channelId, list);

    if (usedCustom) {
      const history = this.usedByGuild.get(guildId) ?? [];
      history.push({ id: usedCustom.id, at: this.now() });
      while (history.length > 60) history.shift();
      this.usedByGuild.set(guildId, history);
      this.repliesSinceCustom.set(channelId, 0);
    } else {
      this.repliesSinceCustom.set(channelId, (this.repliesSinceCustom.get(channelId) ?? Number.MAX_SAFE_INTEGER - 1) + 1);
    }

    for (const map of [this.recentUnicode, this.repliesSinceCustom]) {
      while (map.size > this.MAX_TRACKED) map.delete(map.keys().next().value as string);
    }
  }

  clear(): void {
    this.usedByGuild.clear();
    this.repliesSinceCustom.clear();
    this.recentUnicode.clear();
  }
}

export const customEmojiService = new CustomEmojiService();
