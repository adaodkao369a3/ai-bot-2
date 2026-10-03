/**
 * Character registry for Bocchi personality system
 * Defines character types, emoji mappings, and configuration
 */

/**
 * Emoji semantic keys for character-specific emoji usage
 */
export type EmojiKey = 
  | 'laugh'
  | 'embarrassed'
  | 'annoyed'
  | 'smug'
  | 'sad'
  | 'confused'
  | 'happy'
  | 'angry'
  | 'thinking'
  | 'shrug'
  | 'wave'
  | 'thumbs_up'
  | 'thumbs_down'
  | 'heart'
  | 'fire'
  | 'skull';

/**
 * Character definition interface
 */
export interface Character {
  /** Stable character ID for database storage */
  id: string;
  /** Display name for UI */
  name: string;
  /** Short description for character selector */
  description: string;
  /** System prompt / behavioral instructions */
  systemPrompt: string;
  /** Server nickname to apply (empty = no change) */
  nickname: string;
  /** Avatar asset filenames (empty = no avatar change) */
  avatarAssets: string[];
  /** Invocation names - names users can use to address this character */
  invocationNames: string[];
  /** Emoji map for character-specific emoji usage */
  emojiMap: Record<EmojiKey, string[]>;
  /** Cooldown messages for rate limiting (function to support timestamp formatting) */
  cooldownMessages: ((timestamp: number) => string)[];
  /** Bot disabled messages */
  disabledMessages: string[];
  /** Blacklisted user messages */
  blacklistedMessages: string[];
  /** AI error messages */
  errorMessages: string[];
  /** Character world context - relationships, environment, life details (optional) */
  characterWorld?: string;
}

/**
 * Character registry - central repository of all character definitions
 * Characters can be added here without modifying other files
 */
export const CHARACTER_REGISTRY: Record<string, Character> = {};

/**
 * Register a character in the registry
 */
export function registerCharacter(character: Character): void {
  if (CHARACTER_REGISTRY[character.id]) {
    throw new Error(`Character with ID "${character.id}" is already registered`);
  }
  CHARACTER_REGISTRY[character.id] = character;
}

/**
 * Get a character by ID
 */
export function getCharacter(id: string): Character | undefined {
  return CHARACTER_REGISTRY[id];
}

/**
 * Get all registered characters
 */
export function getAllCharacters(): Character[] {
  return Object.values(CHARACTER_REGISTRY);
}

/**
 * Check if a character ID exists
 */
export function characterExists(id: string): boolean {
  return id in CHARACTER_REGISTRY;
}

/**
 * Get a random emoji from a character's emoji map for a given key
 * Returns null if the key doesn't exist or has no emojis
 */
export function getRandomEmoji(characterId: string, key: EmojiKey): string | null {
  const character = getCharacter(characterId);
  if (!character || !character.emojiMap[key] || character.emojiMap[key].length === 0) {
    return null;
  }
  const emojis = character.emojiMap[key];
  return emojis[Math.floor(Math.random() * emojis.length)];
}