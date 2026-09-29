/**
 * Tests for addressing detection service
 */

import { AddressingService, addressingService as singletonAddressingService } from '../src/services/addressing';
import { BOT_NAME } from '../src/config';
import { getPersonalityManager } from '../src/services/personalityManager';

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

// Mock personality manager
const mockPersonalityManager = {
  getActiveCharacter: jest.fn()
};

jest.mock('../src/services/personalityManager', () => ({
  getPersonalityManager: () => mockPersonalityManager
}));

describe('AddressingService', () => {
  let addressingService: AddressingService;
  const botUserId = 'bot123';
  const guildId = 'guild123';

  beforeEach(() => {
    addressingService = new AddressingService();
    jest.clearAllMocks();
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
    describe('with dynamic invocation names', () => {
      it('should return true when message starts with active character name', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('bocchi what\'s up');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return true for "Bot Kun" invocation name', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bot Kun', 'BotKun', 'bot kun', 'botkun']
        });
        const message = new MockMessage('bot kun what\'s up');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return true for "Heisenberg" invocation name', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Heisenberg', 'heisenberg']
        });
        const message = new MockMessage('heisenberg explain this');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return true for "Bob" invocation name', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bob', 'bob']
        });
        const message = new MockMessage('bob come here');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return true for greeting + name pattern', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('hey bocchi');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return true for "hi Bocchi" pattern', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('hi bocchi');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return true for name-only message', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('bocchi');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should be case insensitive', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('BOCCHI what\'s up');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should handle punctuation after name', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('bocchi, what\'s up?');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should return false when name appears in middle of sentence', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('i saw bocchi yesterday');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(false);
      });

      it('should return false for inactive personality name', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Heisenberg', 'heisenberg']
        });
        const message = new MockMessage('hi bocchi');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(false);
      });

      it('should return false when name is not present', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: ['Bocchi', 'bocchi']
        });
        const message = new MockMessage('hello world');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(false);
      });

      it('should fallback to legacy name matching when personality manager fails', async () => {
        mockPersonalityManager.getActiveCharacter.mockRejectedValue(new Error('Manager error'));
        const message = new MockMessage('bocchi what\'s up');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should fallback to legacy name matching when no invocation names configured', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: []
        });
        const message = new MockMessage('bocchi what\'s up');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });
    });

    describe('legacy fallback behavior', () => {
      it('should use legacy name matching when no invocation names', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: []
        });
        const message = new MockMessage('bocchi chan hello');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });

      it('should use legacy name matching for "hitori gotoh"', async () => {
        mockPersonalityManager.getActiveCharacter.mockResolvedValue({
          invocationNames: []
        });
        const message = new MockMessage('hitori gotoh hello');
        expect(await addressingService.isNameAddress(message as any, guildId)).toBe(true);
      });
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
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('hello @bot', [botUserId]);
      expect(await addressingService.isAddressingBot(message as any, botUserId, guildId)).toBe(true);
    });

    it('should return true for name address', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('bocchi hello');
      expect(await addressingService.isAddressingBot(message as any, botUserId, guildId)).toBe(true);
    });

    it('should return true for reply', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const botMessage = { author: { id: botUserId } };
      const message = new MockMessage('random text', [], botMessage);
      // The message should be detected as addressing the bot because it's a reply
      expect(await addressingService.isAddressingBot(message as any, botUserId, guildId)).toBe(true);
    });

    it('should return false when not addressing bot', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('hello world', [], null);
      expect(await addressingService.isAddressingBot(message as any, botUserId, guildId)).toBe(false);
    });
  });

  describe('extractContent', () => {
    it('should remove bot mention', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage(`<@${botUserId}> hello`, [botUserId]);
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello');
    });

    it('should remove active character name at start', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('bocchi hello world');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello world');
    });

    it('should remove "Bot Kun" variation', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bot Kun', 'BotKun', 'bot kun', 'botkun']
      });
      const message = new MockMessage('bot kun hello');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello');
    });

    it('should remove punctuation after name', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('bocchi, hello!');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello!');
    });

    it('should remove greeting + name pattern', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('hey bocchi what\'s up');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('what\'s up');
    });

    it('should not modify content without name/mention', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: ['Bocchi', 'bocchi']
      });
      const message = new MockMessage('hello world');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello world');
    });

    it('should fallback to legacy name removal when personality manager fails', async () => {
      mockPersonalityManager.getActiveCharacter.mockRejectedValue(new Error('Manager error'));
      const message = new MockMessage('bocchi hello');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello');
    });

    it('should fallback to legacy name removal when no invocation names', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: []
      });
      const message = new MockMessage('bocchi hello');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello');
    });

    it('should handle legacy "bocchi chan" name removal', async () => {
      mockPersonalityManager.getActiveCharacter.mockResolvedValue({
        invocationNames: []
      });
      const message = new MockMessage('bocchi chan hello');
      const extracted = await addressingService.extractContent(message as any, botUserId, guildId);
      expect(extracted).toBe('hello');
    });
  });
});
