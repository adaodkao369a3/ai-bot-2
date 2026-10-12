/**
 * GIF detection and "what is this GIF about" reading. Pure functions, no Discord or database here.
 *
 * Where the meaning of a GIF comes from (no AI is involved, so no tokens are used):
 *  1. The description at the END of the link. Tenor and Giphy put it there:
 *       https://tenor.com/view/gojo-satoru-laughing-gif-27120473   ->  gojo satoru laughing
 *       https://giphy.com/gifs/anime-cat-vibing-3o7TKsQ8...         ->  anime cat vibing
 *  2. The file name of an uploaded GIF ("cat_vibing.gif").
 *  3. The words people typed with the GIF / the message before it (weaker hints).
 *
 * Later, when the bot is about to reply, the words of its reply are scored against stored GIFs
 * so it only posts one that actually fits what it is saying.
 */

export interface GifMessageInput {
  content: string;
  attachments: Array<{ url: string; name?: string | null; contentType?: string | null }>;
  embeds: Array<{ type?: string | null; url?: string | null }>;
}

export interface ExtractedGif {
  /** The link to post again. */
  url: string;
  /** Words describing the GIF taken from the link / file name (strong hints). */
  slugWords: string[];
  /** false for Discord upload links: they expire after a while, so they can't be saved for later. */
  persistent: boolean;
  source: 'link' | 'attachment' | 'embed';
}

/** Hosts whose links expire (signed, time limited). Fine for copying right now, useless to save. */
const EXPIRING_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

const GIF_HOST_PATTERNS = [
  /(^|\.)tenor\.com$/i,
  /(^|\.)giphy\.com$/i,
  /(^|\.)gph\.is$/i,
  /(^|\.)klipy\.com$/i
];

const URL_PATTERN = /https?:\/\/[^\s<>]+/gi;

function cleanUrl(raw: string): string {
  return raw.replace(/[)\]}>.,!?;:'"]+$/, '');
}

function safeParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isPersistentGifUrl(url: string): boolean {
  const parsed = safeParse(url);
  if (!parsed) return false;
  if (EXPIRING_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
  if (parsed.searchParams.has('ex') || parsed.searchParams.has('hm')) return false;
  return true;
}

function looksLikeGifLink(parsed: URL): boolean {
  const path = parsed.pathname.toLowerCase();
  if (/\.(gif|gifv)$/.test(path)) return true;
  return GIF_HOST_PATTERNS.some(pattern => pattern.test(parsed.hostname));
}

/** Find the first GIF in a message: a GIF link in the text, an uploaded GIF, or a GIF embed. */
export function extractGifFromMessage(input: GifMessageInput): ExtractedGif | null {
  // 1. A GIF link typed or picked from Discord's GIF picker (it sends a Tenor/Giphy link)
  for (const match of input.content.matchAll(URL_PATTERN)) {
    const url = cleanUrl(match[0]);
    const parsed = safeParse(url);
    if (parsed && looksLikeGifLink(parsed)) {
      return { url, slugWords: slugWordsFromUrl(url), persistent: isPersistentGifUrl(url), source: 'link' };
    }
  }

  // 2. An uploaded GIF file
  for (const attachment of input.attachments) {
    const isGif = attachment.contentType?.toLowerCase().startsWith('image/gif')
      || /\.gif(\?|$)/i.test(attachment.url)
      || /\.gif$/i.test(attachment.name ?? '');
    if (isGif) {
      return {
        url: attachment.url,
        slugWords: slugWordsFromName(attachment.name ?? ''),
        persistent: isPersistentGifUrl(attachment.url),
        source: 'attachment'
      };
    }
  }

  // 3. A GIF-style embed whose link was not in the text
  for (const embed of input.embeds) {
    if (embed.type === 'gifv' && embed.url) {
      return { url: embed.url, slugWords: slugWordsFromUrl(embed.url), persistent: isPersistentGifUrl(embed.url), source: 'embed' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'have', 'has', 'had', 'are', 'was', 'were',
  'you', 'your', 'yours', 'she', 'her', 'him', 'his', 'they', 'them', 'their', 'its', 'our', 'out', 'but', 'not',
  'just', 'like', 'get', 'got', 'can', 'will', 'would', 'could', 'should', 'about', 'what', 'when', 'where', 'who',
  'why', 'how', 'all', 'any', 'one', 'two', 'now', 'then', 'than', 'too', 'very', 'really', 'also', 'into', 'over',
  'got', 'gonna', 'dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'im', 'ive', 'ill', 'thats', 'its', 'let',
  'bot', 'bro', 'dude', 'man', 'yeah', 'okay',
  // link / file noise
  'gif', 'gifs', 'gifv', 'tenor', 'giphy', 'klipy', 'view', 'media', 'image', 'images', 'img', 'video', 'file',
  'unknown', 'download', 'screenshot', 'http', 'https', 'www', 'com', 'discord', 'cdn', 'attachments', 'animated'
]);

/** Short words that still carry meaning (everything else under 3 letters is dropped). */
const SHORT_KEEPERS = new Set(['no', 'ok', 'hi', 'yo', 'gg', 'rip', 'wtf', 'omg', 'lol', 'lmao', 'idk', 'smh', 'ez']);

/** Light stemming so "laughing", "laughs" and "laugh" count as the same word. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);

  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  // "hugg" -> "hug", "runn" -> "run" (but keep "ll" and "ss")
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !'ls'.includes(w[w.length - 1])) w = w.slice(0, -1);
  return w;
}

/** Meaningful lowercase words in a piece of text (letters/numbers only, stop words removed). */
export function contentWords(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of text.toLowerCase().replace(/<a?:\w+:\d+>/g, ' ').split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || /^\d+$/.test(raw)) continue;
    if (STOP_WORDS.has(raw)) continue;
    if (raw.length < 3 && !SHORT_KEEPERS.has(raw)) continue;
    const s = stem(raw);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** An id such as "27120473" or "3o7TKsQ8mXjhZ1" (long, has digits) is not a word. */
function looksLikeId(token: string): boolean {
  return token.length >= 8 && /\d/.test(token);
}

/** Words from the readable end of a GIF link (see the top of this file). */
export function slugWordsFromUrl(url: string): string[] {
  const parsed = safeParse(url);
  if (!parsed) return [];

  const lastSegment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
    .replace(/\.(gif|gifv|mp4|webp|png)$/i, '');

  const tokens = lastSegment.split(/[-_+. ]+/).filter(token => token && !looksLikeId(token));
  return contentWords(tokens.join(' '));
}

/** Words from an uploaded file's name ("cat_vibing.gif" -> cat, vibing). */
export function slugWordsFromName(name: string): string[] {
  const base = name.replace(/\.(gif|gifv)$/i, '');
  const tokens = base.split(/[-_+. ]+/).filter(token => token && !looksLikeId(token));
  return contentWords(tokens.join(' '));
}

// ---------------------------------------------------------------------------------------------
// Moods ("lmao" and a GIF called "laughing-cat" mean the same thing)
// ---------------------------------------------------------------------------------------------

const EMOTION_WORDS: Record<string, string[]> = {
  laugh: ['lol', 'lmao', 'lmfao', 'haha', 'hahaha', 'laugh', 'laughing', 'funny', 'hilarious', 'rofl', 'cackle', 'giggle', 'kekw', 'dying'],
  cry: ['cry', 'crying', 'sad', 'tears', 'sob', 'sobbing', 'sadge', 'heartbroken', 'weep', 'depressed', 'rip'],
  angry: ['angry', 'mad', 'rage', 'furious', 'pissed', 'annoyed', 'irritated', 'upset', 'triggered'],
  shock: ['shock', 'shocked', 'omg', 'wtf', 'surprised', 'gasp', 'wow', 'speechless', 'unbelievable'],
  no: ['no', 'nope', 'nah', 'never', 'refuse', 'denied', 'deny', 'reject', 'stop'],
  yes: ['yes', 'yep', 'agree', 'nod', 'nodding', 'approved', 'approve', 'correct', 'facts', 'exactly'],
  facepalm: ['facepalm', 'bruh', 'cringe', 'disappointed', 'ugh', 'smh', 'unimpressed', 'eyeroll', 'embarrassing'],
  hype: ['hype', 'excited', 'letsgo', 'pog', 'poggers', 'yay', 'celebrate', 'celebration', 'party', 'victory', 'winner', 'congrats', 'congratulations'],
  dance: ['dance', 'dancing', 'vibe', 'vibing', 'groove', 'bop', 'jam'],
  love: ['hug', 'hugs', 'love', 'cute', 'aww', 'wholesome', 'kiss', 'heart', 'adorable'],
  wave: ['hello', 'wave', 'waving', 'goodbye', 'bye', 'greet', 'hi', 'yo'],
  sleep: ['sleep', 'sleepy', 'tired', 'nap', 'goodnight', 'yawn', 'exhausted', 'bed'],
  eat: ['eat', 'eating', 'hungry', 'snack', 'pizza', 'burger', 'food', 'nuggets', 'popcorn'],
  think: ['think', 'thinking', 'hmm', 'wonder', 'confused', 'confusion', 'huh', 'puzzled', 'question'],
  sus: ['sus', 'suspicious', 'sussy', 'doubt', 'skeptical', 'sideeye', 'judging'],
  smug: ['smug', 'smirk', 'confident', 'swag', 'boss', 'savage', 'flex'],
  scared: ['scared', 'afraid', 'fear', 'terrified', 'panic', 'nervous', 'anxious', 'hide'],
  clap: ['clap', 'clapping', 'applause', 'bravo', 'respect', 'impressed'],
  shrug: ['shrug', 'idk', 'whatever', 'dunno', 'meh', 'shrugging'],
  sorry: ['sorry', 'apologize', 'oops', 'mistake', 'apology']
};

const TAG_BY_STEM: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [tag, words] of Object.entries(EMOTION_WORDS)) {
    for (const word of words) {
      const key = stem(word);
      const tags = map.get(key) ?? [];
      if (!tags.includes(tag)) tags.push(tag);
      map.set(key, tags);
    }
  }
  return map;
})();

/** The moods ("laugh", "cry"...) that a set of (already stemmed) words point to. */
export function moodTags(stems: Iterable<string>): Set<string> {
  const tags = new Set<string>();
  for (const word of stems) {
    for (const tag of TAG_BY_STEM.get(word) ?? []) {
      tags.add(tag);
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

export interface GifWords {
  /** strong hints: stemmed words from the link / file name */
  slug: string[];
  /** weak hints: stemmed words people typed with the GIF or right before it */
  context: string[];
}

/**
 * How well a stored GIF fits what the bot is about to say. 0 = no connection.
 *   +3  a word of the GIF's description is in the bot's text
 *   +1  a word typed with the GIF is in the bot's text
 *   +3  the GIF's description has the same mood as the bot's text ("lmao" vs "laughing")
 *   +1  only the surrounding words have that mood
 */
export function scoreGif(gif: GifWords, queryStems: string[]): number {
  if (queryStems.length === 0) return 0;

  // Everything here is already stemmed (contentWords / slugWordsFromUrl return stems)
  const slug = new Set(gif.slug);
  const context = new Set(gif.context);
  const query = new Set(queryStems);

  let score = 0;
  for (const word of query) {
    if (slug.has(word)) score += 3;
    else if (context.has(word)) score += 1;
  }

  const queryMoods = moodTags(query);
  if (queryMoods.size > 0) {
    const slugMoods = moodTags(slug);
    const contextMoods = moodTags(context);
    for (const mood of queryMoods) {
      if (slugMoods.has(mood)) score += 3;
      else if (contextMoods.has(mood)) score += 1;
    }
  }

  return score;
}
