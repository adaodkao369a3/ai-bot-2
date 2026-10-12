/**
 * Shared "recently posted" memory so the bot never repeats the same GIF, meme or video.
 *
 * Every place that posts media (reaction GIFs, "hug me" style GIFs, memes, idle memes,
 * YouTube links and the GIF copycat) records what it posted here and asks here before
 * posting. Items are remembered for MEDIA_RECENT_TTL_MS or the last
 * MEDIA_RECENT_MAX_PER_SCOPE items per scope, whichever is smaller.
 *
 * A "scope" is just a string such as `gif:<guildId>` or `meme:<channelId>`.
 * Everything is in memory; it resets when the bot restarts, which is fine.
 */

import { MEDIA_RECENT_TTL_MS, MEDIA_RECENT_MAX_PER_SCOPE } from '../config';

/**
 * Turn a URL into a stable key: same GIF with a different query string / signature
 * (Discord CDN links change `?ex=...&hm=...` all the time) must count as the same GIF.
 * Anything that is not an http(s) URL (for example `yt:abc123`) is used as-is.
 */
export function normalizeMediaKey(raw: string): string {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.hostname.toLowerCase()}${path}`;
  } catch {
    return value;
  }
}

export class RecentMediaTracker {
  // scope -> (key -> time it was posted). Map keeps insertion order, oldest first.
  private scopes: Map<string, Map<string, number>> = new Map();
  private readonly MAX_SCOPES = 500;

  constructor(
    private readonly maxPerScope: number = MEDIA_RECENT_MAX_PER_SCOPE,
    private readonly ttlMs: number = MEDIA_RECENT_TTL_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Was this item posted recently in this scope? */
  has(scope: string, item: string): boolean {
    const entries = this.scopes.get(scope);
    if (!entries) return false;

    const key = normalizeMediaKey(item);
    const postedAt = entries.get(key);
    if (postedAt === undefined) return false;

    if (this.now() - postedAt > this.ttlMs) {
      entries.delete(key);
      return false;
    }
    return true;
  }

  /** Remember that this item was just posted in this scope. */
  add(scope: string, item: string): void {
    let entries = this.scopes.get(scope);
    if (!entries) {
      entries = new Map();
    }

    const key = normalizeMediaKey(item);
    entries.delete(key); // re-insert so it moves to the "newest" end
    entries.set(key, this.now());

    // Drop expired items from the old end, then enforce the size cap
    const cutoff = this.now() - this.ttlMs;
    for (const [oldKey, postedAt] of entries) {
      if (postedAt >= cutoff) break;
      entries.delete(oldKey);
    }
    while (entries.size > this.maxPerScope) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }

    // Keep the scope itself "newest" and bound how many scopes we track
    this.scopes.delete(scope);
    this.scopes.set(scope, entries);
    while (this.scopes.size > this.MAX_SCOPES) {
      const oldestScope = this.scopes.keys().next().value as string;
      this.scopes.delete(oldestScope);
    }
  }

  /** Handy for APIs that take a "was this already used?" callback. */
  predicate(scope: string): (item: string) => boolean {
    return (item: string) => this.has(scope, item);
  }

  /** How many items are currently remembered in a scope (for tests / monitoring). */
  size(scope: string): number {
    return this.scopes.get(scope)?.size ?? 0;
  }

  clear(): void {
    this.scopes.clear();
  }
}

export const recentMedia = new RecentMediaTracker();
