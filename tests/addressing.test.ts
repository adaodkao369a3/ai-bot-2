/**
 * Tests for addressing detection service
 */

import { AddressingService, addressingService as singletonAddressingService } from '../src/services/addressing';
import { BOT_NAME } from '../src/config';

// Mock Message
class MockMessage {
  content: string;
  mentions: {
    users: Map<string, any>;
  };
  reference: any;

  constructor(content: string, mentions: string[] = [], reference: any = null) {
    this.content = content;
    this.mentions = {
      users: new Map(mentions.map(id => [id, { id }]))
    };
    this.reference = reference;
  }

  async fetchReference() {
    return this.reference;
  }
}

describe('AddressingService', () => {
  let addressingService: AddressingService;
  const botUserId = 'bot123';

  beforeEach(() => {
    addressingService = new AddressingService();
  });

  afterAll(() => {
    // AddressingService doesn't have timers, but we clean up for consistency
    // No shutdown method needed for this service
  });

  describe('isMention', () => {
    it('should return true when message mentions bot', () => {
      const message = new MockMessage('hello @bot', [botUserId]);
      expect(addressingService.isMention(message as any, botUserId)).toBe(true);
    });

    it('should return false when message does not mention bot', () => {
      const message = new MockMessage('hello @other', ['other']);
      expect(addressingService.isMention(message as any, botUserId)).toBe(false);
    });

    it('should return false when message has no mentions', () => {
      const message = new MockMessage('hello world', []);
      expect(addressingService.isMention(message as any, botUserId)).toBe(false);
    });
  });

  describe('isNameAddress', () => {
    it('should return true when message starts with bot name', () => {
      const message = new MockMessage(`${BOT_NAME} what's up`);
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(true);
    });

    it('should return true for "bot kun" variation', () => {
      const message = new MockMessage('bot kun what\'s up');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(true);
    });

    it('should return true for "bot-kun" variation', () => {
      const message = new MockMessage('bot-kun what\'s up');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(true);
    });

    it('should return true for "botkun" variation', () => {
      const message = new MockMessage('botkun what\'s up');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(true);
    });

    it('should return true when bot name appears with word boundary', () => {
      const message = new MockMessage('hey bot kun how are you');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(true);
    });

    it('should return false when bot name is part of another word', () => {
      const message = new MockMessage('botkunatic is a word');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(false);
    });

    it('should be case insensitive', () => {
      const message = new MockMessage('BOT KUN what\'s up');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(true);
    });

    it('should return false when bot name is not present', () => {
      const message = new MockMessage('hello world');
      expect(addressingService.isNameAddress(message as any, botUserId)).toBe(false);
    });
  });

  describe('isReplyToBot', () => {
    it('should return true when replying to bot message', async () => {
      const botMessage = { author: { id: botUserId } };
      const message = new MockMessage('reply', [], botMessage);
      expect(await addressingService.isReplyToBot(message as any, botUserId)).toBe(true);
    });

    it('should return false when replying to other user', async () => {
      const otherMessage = { author: { id: 'other' } };
      const message = new MockMessage('reply', [], otherMessage);
      expect(await addressingService.isReplyToBot(message as any, botUserId)).toBe(false);
    });

    it('should return false when message has no reference', async () => {
      const message = new MockMessage('message', [], null);
      expect(await addressingService.isReplyToBot(message as any, botUserId)).toBe(false);
    });
  });

  describe('isAddressingBot', () => {
    it('should return true for mention', async () => {
      const message = new MockMessage('hello @bot', [botUserId]);
      expect(await addressingService.isAddressingBot(message as any, botUserId)).toBe(true);
    });

    it('should return true for name address', async () => {
      const message = new MockMessage('bot kun hello');
      expect(await addressingService.isAddressingBot(message as any, botUserId)).toBe(true);
    });

    it('should return true for reply', async () => {
      const botMessage = { author: { id: botUserId } };
      const message = new MockMessage('reply', [], botMessage);
      expect(await addressingService.isAddressingBot(message as any, botUserId)).toBe(true);
    });

    it('should return false when not addressing bot', async () => {
      const message = new MockMessage('hello world', [], null);
      expect(await addressingService.isAddressingBot(message as any, botUserId)).toBe(false);
    });
  });

  describe('extractContent', () => {
    it('should remove bot mention', () => {
      const message = new MockMessage(`<@${botUserId}> hello`, [botUserId]);
      const extracted = addressingService.extractContent(message as any, botUserId);
      expect(extracted).toBe('hello');
    });

    it('should remove bot name at start', () => {
      const message = new MockMessage('bot kun hello world');
      const extracted = addressingService.extractContent(message as any, botUserId);
      expect(extracted).toBe('hello world');
    });

    it('should remove bot-kun variation', () => {
      const message = new MockMessage('bot-kun hello');
      const extracted = addressingService.extractContent(message as any, botUserId);
      expect(extracted).toBe('hello');
    });

    it('should remove punctuation after bot name', () => {
      const message = new MockMessage('bot kun, hello!');
      const extracted = addressingService.extractContent(message as any, botUserId);
      expect(extracted).toBe('hello!');
    });

    it('should not modify content without bot name/mention', () => {
      const message = new MockMessage('hello world');
      const extracted = addressingService.extractContent(message as any, botUserId);
      expect(extracted).toBe('hello world');
    });
  });
});
