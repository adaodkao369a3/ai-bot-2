/**
 * Tests for rate limiting service
 */

import { RateLimitService, rateLimitService as singletonRateLimitService } from '../src/services/rateLimit';
import { RATE_LIMIT_MAX_INTERACTIONS, RATE_LIMIT_WINDOW_MS } from '../src/config';

describe('RateLimitService', () => {
  let rateLimitService: RateLimitService;

  beforeEach(() => {
    rateLimitService = new RateLimitService();
  });

  afterEach(() => {
    rateLimitService.shutdown();
  });

  afterAll(() => {
    singletonRateLimitService.shutdown();
  });

  describe('canInteract', () => {
    it('should allow interaction for new user', () => {
      const result = rateLimitService.canInteract('user123');
      expect(result.allowed).toBe(true);
      expect(result.resetTime).toBeUndefined();
    });

    it('should allow interaction within limit', () => {
      const userId = 'user123';
      
      // Record interactions up to limit - 1
      for (let i = 0; i < RATE_LIMIT_MAX_INTERACTIONS - 1; i++) {
        rateLimitService.recordInteraction(userId);
      }

      const result = rateLimitService.canInteract(userId);
      expect(result.allowed).toBe(true);
    });

    it('should deny interaction when limit exceeded', () => {
      const userId = 'user123';
      
      // Record interactions up to limit
      for (let i = 0; i < RATE_LIMIT_MAX_INTERACTIONS; i++) {
        rateLimitService.recordInteraction(userId);
      }

      const result = rateLimitService.canInteract(userId);
      expect(result.allowed).toBe(false);
      expect(result.resetTime).toBeDefined();
    });

    it('should reset after window expires', () => {
      const userId = 'user123';
      
      // Record interactions up to limit
      for (let i = 0; i < RATE_LIMIT_MAX_INTERACTIONS; i++) {
        rateLimitService.recordInteraction(userId);
      }

      // Manually expire the window by manipulating the entry
      const entry = (rateLimitService as any).userLimits.get(userId);
      if (entry) {
        entry.windowStart = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
      }

      const result = rateLimitService.canInteract(userId);
      expect(result.allowed).toBe(true);
    });
  });

  describe('recordInteraction', () => {
    it('should create new entry for new user', () => {
      rateLimitService.recordInteraction('user123');
      expect(rateLimitService.getCurrentCount('user123')).toBe(1);
    });

    it('should increment count for existing user', () => {
      const userId = 'user123';
      rateLimitService.recordInteraction(userId);
      rateLimitService.recordInteraction(userId);
      expect(rateLimitService.getCurrentCount(userId)).toBe(2);
    });

    it('should reset count when window expires', () => {
      const userId = 'user123';
      rateLimitService.recordInteraction(userId);
      
      // Manually expire the window
      const entry = (rateLimitService as any).userLimits.get(userId);
      if (entry) {
        entry.windowStart = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
      }

      rateLimitService.recordInteraction(userId);
      expect(rateLimitService.getCurrentCount(userId)).toBe(1);
    });
  });

  describe('getCurrentCount', () => {
    it('should return 0 for new user', () => {
      expect(rateLimitService.getCurrentCount('user123')).toBe(0);
    });

    it('should return current count for user', () => {
      const userId = 'user123';
      rateLimitService.recordInteraction(userId);
      rateLimitService.recordInteraction(userId);
      expect(rateLimitService.getCurrentCount(userId)).toBe(2);
    });

    it('should return 0 when window expired', () => {
      const userId = 'user123';
      rateLimitService.recordInteraction(userId);
      
      const entry = (rateLimitService as any).userLimits.get(userId);
      if (entry) {
        entry.windowStart = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
      }

      expect(rateLimitService.getCurrentCount(userId)).toBe(0);
    });
  });

  describe('getResetTime', () => {
    it('should return null for new user', () => {
      expect(rateLimitService.getResetTime('user123')).toBeNull();
    });

    it('should return reset time for rate-limited user', () => {
      const userId = 'user123';
      
      for (let i = 0; i < RATE_LIMIT_MAX_INTERACTIONS; i++) {
        rateLimitService.recordInteraction(userId);
      }

      const resetTime = rateLimitService.getResetTime(userId);
      expect(resetTime).toBeDefined();
      expect(resetTime).toBeGreaterThan(Date.now());
    });

    it('should return null when window expired', () => {
      const userId = 'user123';
      rateLimitService.recordInteraction(userId);
      
      const entry = (rateLimitService as any).userLimits.get(userId);
      if (entry) {
        entry.windowStart = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
      }

      expect(rateLimitService.getResetTime(userId)).toBeNull();
    });
  });

  describe('clearAll', () => {
    it('should clear all rate limit data', () => {
      rateLimitService.recordInteraction('user123');
      rateLimitService.recordInteraction('user456');
      
      rateLimitService.clearAll();
      
      expect(rateLimitService.getCurrentCount('user123')).toBe(0);
      expect(rateLimitService.getCurrentCount('user456')).toBe(0);
      expect(rateLimitService.getCacheSize()).toBe(0);
    });
  });

  describe('clearUser', () => {
    it('should clear rate limit data for specific user', () => {
      rateLimitService.recordInteraction('user123');
      rateLimitService.recordInteraction('user456');
      
      rateLimitService.clearUser('user123');
      
      expect(rateLimitService.getCurrentCount('user123')).toBe(0);
      expect(rateLimitService.getCurrentCount('user456')).toBe(1);
    });
  });

  describe('getCacheSize', () => {
    it('should return 0 for empty cache', () => {
      expect(rateLimitService.getCacheSize()).toBe(0);
    });

    it('should return number of tracked users', () => {
      rateLimitService.recordInteraction('user123');
      rateLimitService.recordInteraction('user456');
      rateLimitService.recordInteraction('user789');
      
      expect(rateLimitService.getCacheSize()).toBe(3);
    });
  });
});
