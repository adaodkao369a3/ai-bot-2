/**
 * Small helpers for posting images the way a person would: as a plain attachment (no embed card).
 */

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/**
 * A sensible file name for an image URL, e.g. https://i.redd.it/abc123.jpg -> "meme.jpg".
 * Discord shows the attachment as an image based on the extension, so keep the real one.
 */
export function imageFileName(url: string, baseName = 'meme'): string {
  try {
    const path = new URL(url).pathname;
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    if (IMAGE_EXTENSIONS.has(extension)) {
      return `${baseName}.${extension}`;
    }
  } catch {
    // not a valid URL: fall through to the default
  }
  return `${baseName}.png`;
}

/** Random whole number of milliseconds between min and max (inclusive-ish), for human-looking delays. */
export function randomDelayMs(minMs: number, maxMs: number, random: () => number = Math.random): number {
  if (maxMs <= minMs) return Math.max(0, minMs);
  return Math.floor(minMs + random() * (maxMs - minMs));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
