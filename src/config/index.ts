/**
 * Centralized configuration for bot
 * All behavioral constants and role IDs should be defined here
 */

export const BOT_NAME = "bot";

// Discord Role IDs
export const EXTRA_ROLE_ID = "1535285274832277514";
export const FEATURED_EXTRA_ROLE_ID = "1535285299410771988";
export const SUPPORTING_CAST_ROLE_ID = "1535285344952651829";

// Channel IDs
export const GUIDE_CHANNEL_ID = ""; // Designated rules/overview channel for ~guide command (to be configured)

// Rate limiting configuration
export const RATE_LIMIT_MAX_INTERACTIONS = 10;
export const RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

// Meme configuration
export const MEME_API_URL = "https://meme-api.com/gimme";
export const MEME_FETCH_TIMEOUT_MS = 5000;

// Idle meme: after someone CALLS the bot in a channel and then the channel goes quiet, the bot
// drops ONE meme in that channel (plain image, no embed). It never drops another until someone
// calls the bot again. Memes are never dropped in channels the bot was not called in.
export const MEME_IDLE_ENABLED = process.env.MEME_IDLE_ENABLED !== 'false';
export const MEME_IDLE_AFTER_MS = 5 * 60 * 1000; // channel must be quiet this long ("like 5 minutes")
export const MEME_IDLE_JITTER_MS = 2 * 60 * 1000; // plus up to this much random extra, so it feels human
export const MEME_IDLE_SESSION_MAX_MS = 60 * 60 * 1000; // a call older than this is stale: no meme for it

// GIF library: GIFs people post are remembered (link + keywords only, never who posted them or
// what they said) so the bot can reuse one later when it fits what it is saying.
export const GIF_LIBRARY_ENABLED = process.env.GIF_LIBRARY_ENABLED !== 'false';
export const GIF_LIBRARY_MAX_PER_GUILD = 300; // oldest entries are dropped beyond this
export const GIF_LIBRARY_MIN_MATCH_SCORE = 3; // how well a stored GIF must fit; below this the bot posts none
export const GIF_LIBRARY_CHANCE = 0.5; // when the bot may attach a GIF to a reply, chance it tries the library first

// Memory configuration
export const MEMORY_ACTIVE_MEMBER_CAP = 25;
export const MEMORY_CONFIDENCE_THRESHOLD = 0.50; // Minimum confidence to consider memory valid
export const MEMORY_INITIAL_CONFIDENCE = 0.30; // Starting confidence for new memories
export const MEMORY_MAX_CONFIDENCE = 1.00; // Maximum confidence cap
export const MEMORY_CONFIDENCE_INCREMENT = 0.15; // Confidence increase per confirmation
export const MEMORY_RETRIEVAL_LIMIT = 5; // Max memories to retrieve per query (reduced from 10 to save tokens)
export const MEMORY_MIN_MESSAGE_LENGTH = 15; // Minimum message length for extraction
export const MEMORY_EXTRACTION_TIMEOUT_MS = 10000; // Timeout for AI memory extraction

// Conversation context configuration
export const CONVERSATION_CONTEXT_MAX_MESSAGES = 5; // Max messages to include in context (reduced from 10 to save tokens)
export const CONVERSATION_CONTEXT_MAX_MESSAGE_LENGTH = 300; // Max characters per history message (truncate long messages)

// AI configuration
export const AI_MAX_RETRIES = 2;
export const AI_TIMEOUT_MS = 30000; // 30 seconds
// Max completion tokens per reply (reduced from 350). On reasoning models such as
// openai/gpt-oss-20b the hidden "thinking" tokens count toward this cap too, so keep
// some headroom above the ~50 tokens a 1-2 sentence reply needs. Override with the
// AI_MAX_TOKENS env var on Railway.
export const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || 300;

/**
 * Read a numeric tunable from an environment variable (so it can be changed on Railway
 * without redeploying code), falling back to the default when unset or not a number.
 */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Repeat protection: the bot should never post the same GIF / meme / video / message twice in a row
export const MEDIA_RECENT_TTL_MS = 12 * 60 * 60 * 1000; // remember posted media for 12 hours
export const MEDIA_RECENT_MAX_PER_SCOPE = 300; // ...or the last 300 items per server/channel, whichever is smaller
export const REPLY_REPEAT_WINDOW = 12; // compare a new reply with the last N replies in the same channel
export const REPLY_REPEAT_TTL_MS = 60 * 60 * 1000; // replies older than 1 hour no longer count as "recent"
export const REPLY_SIMILARITY_THRESHOLD = 0.8; // 0-1, how alike two replies must be to count as a repeat
export const CANNED_NO_REPEAT_COUNT = 3; // canned lines (hug texts, error lines...) skip the last N used

// GIF copycat: once in a while the bot posts the same GIF someone else just posted
export const GIF_COPY_ENABLED = process.env.GIF_COPY_ENABLED !== 'false';
export const GIF_COPY_CHANCE = envNumber('GIF_COPY_CHANCE', 0.10); // chance per GIF posted
export const GIF_COPY_CHANNEL_COOLDOWN_MS = envNumber('GIF_COPY_CHANNEL_COOLDOWN_MS', 10 * 60 * 1000);
export const GIF_COPY_USER_COOLDOWN_MS = envNumber('GIF_COPY_USER_COOLDOWN_MS', 30 * 60 * 1000);
export const GIF_COPY_DELAY_MIN_MS = envNumber('GIF_COPY_DELAY_MIN_MS', 3000);
export const GIF_COPY_DELAY_MAX_MS = envNumber('GIF_COPY_DELAY_MAX_MS', 8000);

// Server custom emojis in replies: used now and then, never spammed, never repeated back to back
export const CUSTOM_EMOJI_ENABLED = process.env.CUSTOM_EMOJI_ENABLED !== 'false';
export const CUSTOM_EMOJI_OFFER_CHANCE = envNumber('CUSTOM_EMOJI_OFFER_CHANCE', 0.4); // chance a reply is allowed one
export const CUSTOM_EMOJI_MIN_REPLY_GAP = envNumber('CUSTOM_EMOJI_MIN_REPLY_GAP', 2); // replies without one between uses
export const CUSTOM_EMOJI_OFFER_COUNT = envNumber('CUSTOM_EMOJI_OFFER_COUNT', 6); // emojis shown to the AI per offer
export const CUSTOM_EMOJI_MAX_PER_REPLY = 1; // hard cap, enforced after the AI answers
export const CUSTOM_EMOJI_NO_REPEAT_COUNT = envNumber('CUSTOM_EMOJI_NO_REPEAT_COUNT', 10); // an emoji waits for N other uses
export const CUSTOM_EMOJI_REUSE_COOLDOWN_MS = envNumber('CUSTOM_EMOJI_REUSE_COOLDOWN_MS', 20 * 60 * 1000);
export const UNICODE_EMOJI_REPEAT_WINDOW = 3; // don't reuse an emoji that was in the last N bot replies in a channel
export const MAX_EMOJI_PER_REPLY = 2; // custom + normal emojis combined

// Permission system - Feature names
export const PERMISSIONS = {
  MEMORY: 'memory',
  MEME: 'meme',
  GIF: 'gif',
  YOUTUBE: 'youtube'
} as const;
