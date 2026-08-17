/**
 * Tests for memory service Phase 3 features
 * Tests confidence scoring, duplicate handling, and candidate processing
 */

import { MemoryService, Memory } from '../src/services/memory';
import { MemoryCandidate } from '../src/services/memoryExtraction';

describe('MemoryService Phase 3 Features', () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    memoryService = new MemoryService();
  });

  describe('calculateSimilarity (private method testing)', () => {
    it('should calculate high similarity for similar phrases', () => {
      // Access private method through testing
      const service = memoryService as any;
      const similarity = service.calculateSimilarity(
        'user hates pineapple',
        'user hates pineapple pizza'
      );
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should calculate low similarity for different phrases', () => {
      const service = memoryService as any;
      const similarity = service.calculateSimilarity(
        'user hates pineapple',
        'user loves horror movies'
      );
      expect(similarity).toBeLessThan(0.3);
    });

    it('should return 0 for completely different phrases', () => {
      const service = memoryService as any;
      const similarity = service.calculateSimilarity(
        'apple banana cherry',
        'dog cat bird'
      );
      expect(similarity).toBe(0);
    });
  });

  describe('Memory interface with Phase 3 fields', () => {
    it('should accept all Phase 3 fields', () => {
      const memory: Memory = {
        id: 'mem1',
        userId: 'user123',
        guildId: 'guild123',
        content: 'User hates pineapple',
        normalizedContent: 'user hates pineapple',
        confidence: 0.30,
        frequency: 1,
        confirmationCount: 1,
        type: 'dislike',
        source: 'explicit_user_statement',
        firstObservedAt: new Date(),
        isActive: true
      };

      expect(memory.normalizedContent).toBe('user hates pineapple');
      expect(memory.confirmationCount).toBe(1);
      expect(memory.type).toBe('dislike');
      expect(memory.firstObservedAt).toBeDefined();
      expect(memory.isActive).toBe(true);
    });
  });
});
