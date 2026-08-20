/**
 * Response memory service for Bot-Kun
 * Tracks recent responses to avoid repetition
 */

import { logger } from '../utils/logger';

export class ResponseMemoryService {
  private recentResponses: string[] = [];
  private readonly AVOID_LAST_N_RESPONSES = 10;

  /**
   * Add a response to memory
   */
  addResponse(response: string): void {
    const normalized = this.normalizeResponse(response);
    this.recentResponses.push(normalized);
    
    // Keep only the last N responses
    if (this.recentResponses.length > this.AVOID_LAST_N_RESPONSES) {
      this.recentResponses.shift();
    }
  }

  /**
   * Check if a response is too similar to recent ones
   */
  isTooSimilar(response: string): boolean {
    const normalized = this.normalizeResponse(response);
    
    for (const recent of this.recentResponses) {
      if (this.calculateSimilarity(normalized, recent) > 0.8) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Normalize response for comparison (lowercase, remove extra whitespace)
   */
  private normalizeResponse(response: string): string {
    return response.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Calculate similarity between two strings (simple Jaccard-like approach)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    
    const words1 = new Set(str1.split(' '));
    const words2 = new Set(str2.split(' '));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Clear all memory (useful for testing)
   */
  clearMemory(): void {
    this.recentResponses = [];
  }

  /**
   * Get current memory size
   */
  getMemorySize(): number {
    return this.recentResponses.length;
  }
}

export const responseMemoryService = new ResponseMemoryService();
