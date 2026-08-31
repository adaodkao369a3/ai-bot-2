/**
 * Centralized configuration for Bocchi
 * All behavioral constants and role IDs should be defined here
 */

export const BOT_NAME = "bocchi";

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
// Time-based meme drops every 15 minutes with reply detection
export const MEME_API_URL = "https://meme-api.com/gimme";
export const MEME_IDLE_ENABLED = true;
export const MEME_IDLE_INACTIVITY_MINUTES = 0; // Not used in new system
export const MEME_IDLE_PROBABILITY = 1.0; // Always drop when time is up
export const MEME_IDLE_COOLDOWN_MINUTES = 15; // Fixed 15-minute intervals
export const MEME_FETCH_TIMEOUT_MS = 5000;

// Memory configuration
export const MEMORY_ACTIVE_MEMBER_CAP = 25;
export const MEMORY_CONFIDENCE_THRESHOLD = 0.50; // Minimum confidence to consider memory valid
export const MEMORY_INITIAL_CONFIDENCE = 0.30; // Starting confidence for new memories
export const MEMORY_MAX_CONFIDENCE = 1.00; // Maximum confidence cap
export const MEMORY_CONFIDENCE_INCREMENT = 0.15; // Confidence increase per confirmation
export const MEMORY_RETRIEVAL_LIMIT = 10; // Max memories to retrieve per query
export const MEMORY_MIN_MESSAGE_LENGTH = 15; // Minimum message length for extraction
export const MEMORY_EXTRACTION_TIMEOUT_MS = 10000; // Timeout for AI memory extraction

// Conversation context configuration
export const CONVERSATION_CONTEXT_MAX_MESSAGES = 10; // Max messages to include in context

// AI configuration
export const AI_MAX_RETRIES = 2;
export const AI_TIMEOUT_MS = 30000; // 30 seconds

// Permission system - Feature names
export const PERMISSIONS = {
  MEMORY: 'memory',
  MEME: 'meme',
  GIF: 'gif',
  YOUTUBE: 'youtube'
} as const;
