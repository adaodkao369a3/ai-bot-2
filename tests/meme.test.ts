/**
 * Tests for meme drop tracking logic
 */

import { MemeService } from '../src/services/meme';
import { MEME_MIN_MESSAGES_BEFORE_DROP, MEME_MAX_MESSAGES_BEFORE_DROP } from '../src/config';

describe('MemeService', () => {
  let memeService: MemeService;

  beforeEach(() => {
    memeService = new MemeService();
  });

  describe('shouldDropMeme', () => {
    it('should not drop a meme on the very first message', () => {
      expect(memeService.shouldDropMeme('user1')).toBe(false);
    });

    it('should drop a meme by the max threshold of exchanges', () => {
      let droppedAtLeastOnce = false;
      for (let i = 0; i < MEME_MAX_MESSAGES_BEFORE_DROP; i++) {
        if (memeService.shouldDropMeme('user1')) {
          droppedAtLeastOnce = true;
        }
      }
      expect(droppedAtLeastOnce).toBe(true);
    });

    it('should never trigger before the min threshold of exchanges', () => {
      for (let i = 0; i < MEME_MIN_MESSAGES_BEFORE_DROP - 1; i++) {
        expect(memeService.shouldDropMeme('user1')).toBe(false);
      }
    });

    it('should track separate counters per user', () => {
      for (let i = 0; i < MEME_MAX_MESSAGES_BEFORE_DROP - 1; i++) {
        memeService.shouldDropMeme('user1');
      }
      // user2 is fresh and shouldn't be affected by user1's count
      expect(memeService.shouldDropMeme('user2')).toBe(false);
    });

    it('should reset the counter after dropping a meme', () => {
      let triggeredCount = 0;
      for (let i = 0; i < MEME_MAX_MESSAGES_BEFORE_DROP; i++) {
        if (memeService.shouldDropMeme('user1')) {
          triggeredCount++;
        }
      }
      expect(triggeredCount).toBe(1);
    });
  });

  describe('clearAll', () => {
    it('should reset all tracked state', () => {
      for (let i = 0; i < MEME_MAX_MESSAGES_BEFORE_DROP; i++) {
        memeService.shouldDropMeme('user1');
      }
      memeService.clearAll();
      expect(memeService.shouldDropMeme('user1')).toBe(false);
    });
  });
});
