/**
 * Tests for conversation context service
 */

import { ConversationContextService, conversationContextService as singletonConversationContextService } from '../src/services/conversationContext';
import { CONVERSATION_CONTEXT_MAX_MESSAGES } from '../src/config';

describe('ConversationContextService', () => {
  let contextService: ConversationContextService;

  beforeEach(() => {
    contextService = new ConversationContextService();
  });

  afterEach(() => {
    contextService.shutdown();
  });

  afterAll(() => {
    singletonConversationContextService.shutdown();
  });

  describe('addMessage', () => {
    it('should add message to context', () => {
      const channelId = 'channel123';
      contextService.addMessage(channelId, 'user123', 'testuser', 'hello', false);
      
      const context = contextService.getContext(channelId);
      expect(context).toHaveLength(1);
      expect(context[0].content).toBe('hello');
    });

    it('should enforce max messages per channel', () => {
      const channelId = 'channel123';
      
      // Add more messages than max
      for (let i = 0; i < CONVERSATION_CONTEXT_MAX_MESSAGES + 5; i++) {
        contextService.addMessage(channelId, 'user123', 'testuser', `message ${i}`, false);
      }
      
      const context = contextService.getContext(channelId);
      expect(context.length).toBe(CONVERSATION_CONTEXT_MAX_MESSAGES);
    });

    it('should remove oldest message when exceeding limit', () => {
      const channelId = 'channel123';
      
      contextService.addMessage(channelId, 'user1', 'user1', 'first', false);
      contextService.addMessage(channelId, 'user2', 'user2', 'second', false);
      
      // Fill to limit
      for (let i = 0; i < CONVERSATION_CONTEXT_MAX_MESSAGES; i++) {
        contextService.addMessage(channelId, 'user3', 'user3', `message ${i}`, false);
      }
      
      const context = contextService.getContext(channelId);
      expect(context[0].content).not.toBe('first');
    });

    it('should track multiple channels separately', () => {
      const channel1 = 'channel1';
      const channel2 = 'channel2';
      
      contextService.addMessage(channel1, 'user1', 'user1', 'message 1', false);
      contextService.addMessage(channel2, 'user2', 'user2', 'message 2', false);
      
      expect(contextService.getContext(channel1)).toHaveLength(1);
      expect(contextService.getContext(channel2)).toHaveLength(1);
    });
  });

  describe('getContext', () => {
    it('should return empty array for non-existent channel', () => {
      const context = contextService.getContext('nonexistent');
      expect(context).toEqual([]);
    });

    it('should return copy of context (not reference)', () => {
      const channelId = 'channel123';
      contextService.addMessage(channelId, 'user123', 'testuser', 'hello', false);
      
      const context1 = contextService.getContext(channelId);
      const context2 = contextService.getContext(channelId);
      
      expect(context1).not.toBe(context2);
      expect(context1).toEqual(context2);
    });
  });

  describe('getFormattedContext', () => {
    it('should return empty string for empty context', () => {
      const formatted = contextService.getFormattedContext('channel123');
      expect(formatted).toBe('');
    });

    it('should format messages correctly', () => {
      const channelId = 'channel123';
      contextService.addMessage(channelId, 'user123', 'testuser', 'hello', false);
      contextService.addMessage(channelId, 'bot123', 'Bot Kun', 'hi there', true);
      
      const formatted = contextService.getFormattedContext(channelId);
      expect(formatted).toContain('testuser: hello');
      expect(formatted).toContain('Bot Kun: hi there');
    });
  });

  describe('clearChannel', () => {
    it('should clear context for specific channel', () => {
      const channelId = 'channel123';
      contextService.addMessage(channelId, 'user123', 'testuser', 'hello', false);
      
      contextService.clearChannel(channelId);
      
      expect(contextService.getContext(channelId)).toEqual([]);
    });

    it('should not affect other channels', () => {
      const channel1 = 'channel1';
      const channel2 = 'channel2';
      
      contextService.addMessage(channel1, 'user1', 'user1', 'message 1', false);
      contextService.addMessage(channel2, 'user2', 'user2', 'message 2', false);
      
      contextService.clearChannel(channel1);
      
      expect(contextService.getContext(channel1)).toEqual([]);
      expect(contextService.getContext(channel2)).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should clear all contexts', () => {
      contextService.addMessage('channel1', 'user1', 'user1', 'message 1', false);
      contextService.addMessage('channel2', 'user2', 'user2', 'message 2', false);
      
      contextService.clearAll();
      
      expect(contextService.getContext('channel1')).toEqual([]);
      expect(contextService.getContext('channel2')).toEqual([]);
    });
  });

  describe('getContextSize', () => {
    it('should return 0 for empty service', () => {
      expect(contextService.getContextSize()).toBe(0);
    });

    it('should return total message count across all channels', () => {
      contextService.addMessage('channel1', 'user1', 'user1', 'message 1', false);
      contextService.addMessage('channel1', 'user2', 'user2', 'message 2', false);
      contextService.addMessage('channel2', 'user3', 'user3', 'message 3', false);
      
      expect(contextService.getContextSize()).toBe(3);
    });
  });

  describe('getChannelCount', () => {
    it('should return 0 for empty service', () => {
      expect(contextService.getChannelCount()).toBe(0);
    });

    it('should return number of tracked channels', () => {
      contextService.addMessage('channel1', 'user1', 'user1', 'message 1', false);
      contextService.addMessage('channel2', 'user2', 'user2', 'message 2', false);
      
      expect(contextService.getChannelCount()).toBe(2);
    });
  });
});
