/**
 * Response sanitizer for Bot Kun v2
 * Provides security layers to prevent malicious Discord mentions and response format issues
 */

import { logger } from '../utils/logger';

export class ResponseSanitizer {
  /**
   * Sanitize AI response to prevent Discord mention abuse
   * Removes or neutralizes @everyone, @here, user mentions, and role mentions
   */
  sanitizeDiscordMentions(content: string): string {
    let sanitized = content;

    // Remove @everyone and @here
    sanitized = sanitized.replace(/@everyone/g, '@​everyone'); // Zero-width space to break mention
    sanitized = sanitized.replace(/@here/g, '@​here');

    // Keep user mentions so Bot Kun can naturally refer to people in conversation.
    // The router controls which mentions Discord is actually allowed to notify.
    sanitized = sanitized.replace(/<@!?(\d+)>/g, (match, userId) => {
      logger.debug('Preserving user mention in AI response', { userId });
      return match;
    });

    // Still block role mentions because roles can notify large groups.
    sanitized = sanitized.replace(/<@&(\d+)>/g, (_match, roleId) => {
      logger.warn('Detected and blocked role mention in AI response', { roleId });
      return '@role';
    });

    return sanitized;
  }

  /**
   * Normalize response format to prevent JSON/internal structure leakage
   * Removes JSON objects, control markers, and excessive quotation marks
   */
  normalizeResponseFormat(content: string): string {
    let normalized = content.trim();

    // Remove JSON-like structures at the start or end
    // Pattern: {message: "..."} or {"message":"..."}
    const jsonMatch = normalized.match(/^\{[^}]*"message"\s*:\s*"([^"]*)"[^}]*\}\s*/i);
    if (jsonMatch) {
      normalized = jsonMatch[1]; // Extract just the message content
    } else {
      // Fallback: remove entire JSON object if we can't parse it
      normalized = normalized.replace(/^\{[^}]*\}\s*/i, '');
    }

    // Remove control markers like [gif: true]
    normalized = normalized.replace(/\[gif:\s*true\]/gi, '');
    normalized = normalized.replace(/\[gif:\s*false\]/gi, '');
    normalized = normalized.replace(/\[[^\]]*\]/g, (match) => {
      // Only remove if it looks like a control marker (contains colons, true/false, etc.)
      if (/:\s*(true|false|null|\d+)/i.test(match)) {
        return '';
      }
      return match; // Keep normal brackets like [this]
    });

    // Remove excessive wrapping quotes but keep legitimate quotes
    // If the entire response is wrapped in quotes, remove them
    if (/^"[^"]*"$/.test(normalized) && !this.hasLegitimateQuotes(normalized)) {
      normalized = normalized.slice(1, -1);
    }

    // Clean up any remaining JSON-like artifacts
    normalized = normalized.replace(/,\s*}/g, '}'); // Trailing commas in objects
    normalized = normalized.replace(/,\s*]/g, ']'); // Trailing commas in arrays

    return normalized.trim();
  }

  /**
   * Check if quotes are legitimate (part of natural language)
   * vs artificial wrapping
   */
  private hasLegitimateQuotes(content: string): boolean {
    // Legitimate quotes are usually within sentences, not wrapping the entire thing
    const trimmed = content.trim();
    if (!/^"[^"]*"$/.test(trimmed)) {
      return true; // Not wrapped, so quotes are legitimate
    }

    // If wrapped, check if there are internal quotes or punctuation that suggests natural language
    const inner = trimmed.slice(1, -1);
    return /["'.,!?;:]/.test(inner) || inner.includes(' ') && /[a-zA-Z]/.test(inner);
  }

  /**
   * Complete sanitization pipeline
   * Applies all security layers in sequence
   */
  sanitize(content: string): string {
    let sanitized = content;

    // Step 1: Normalize format to remove internal structure leakage
    sanitized = this.normalizeResponseFormat(sanitized);

    // Step 2: Sanitize Discord mentions
    sanitized = this.sanitizeDiscordMentions(sanitized);

    // Step 3: Final cleanup
    sanitized = sanitized.trim();

    // Log if any sanitization occurred
    if (sanitized !== content) {
      logger.debug('Response was sanitized', {
        originalLength: content.length,
        sanitizedLength: sanitized.length
      });
    }

    return sanitized;
  }

  /**
   * Check if content contains potential prompt injection patterns
   * This is for detection/logging, not prevention (prevention is in prompt construction)
   */
  detectPromptInjection(content: string): boolean {
    const injectionPatterns = [
      /ignore\s+(previous|all|above)?\s*instructions/i,
      /disregard\s+(previous|all|above)?\s*instructions/i,
      /forget\s+(previous|all|above)?\s*instructions/i,
      /system\s*prompt/i,
      /developer\s*(message|instruction|command)/i,
      /admin\s*(message|instruction|command)/i,
      /override\s+(security|safety|rules)/i,
      /disable\s+(safety|security|filter)/i,
      /new\s*(system|developer)?\s*prompt/i,
      /reveal\s*(your|system)\s*prompt/i,
      /print\s*(your|system)\s*prompt/i,
      /show\s*(your|system)\s*instructions/i,
      /mention\s+(everyone|here|@)/i,
      /ping\s+(everyone|here|@)/i,
      /tag\s+(everyone|here|@)/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(content)) {
        logger.warn('Detected potential prompt injection pattern', { pattern: pattern.source });
        return true;
      }
    }

    return false;
  }
}

export const responseSanitizer = new ResponseSanitizer();
