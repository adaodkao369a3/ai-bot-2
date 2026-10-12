/**
 * Drives the REAL MessageRouter.handleMessage with fake services around it, to prove the new
 * features are actually wired into the reply flow.
 */

const mockGenerate = jest.fn();

jest.mock('../src/utils/env', () => ({ env: { GROQ_API_KEY: 'test', KLIPY_KEY: '', YOUTUBE_API_KEY: '' } }));
jest.mock('../src/services/ai', () => ({
  createAIService: () => ({ generateResponse: (...args: unknown[]) => mockGenerate(...args) })
}));
jest.mock('../src/services/botState', () => ({ botStateService: { isEnabled: jest.fn(async () => true) } }));
jest.mock('../src/services/blacklist', () => ({ blacklistService: { isBlacklisted: jest.fn(async () => false) } }));
jest.mock('../src/services/rateLimit', () => ({ rateLimitService: { canInteract: () => ({ allowed: true }), recordInteraction: jest.fn() } }));
jest.mock('../src/services/permissions', () => ({ permissionService: { isStaff: () => false, hasMemoryEligibility: () => false } }));
jest.mock('../src/services/channelRestrictions', () => ({ channelRestrictionsService: { isChannelAllowed: jest.fn(async () => true) } }));
jest.mock('../src/services/featureToggle', () => ({ featureToggleService: { isEnabled: jest.fn(async () => true) } }));
jest.mock('../src/services/addressing', () => ({
  addressingService: {
    isAddressingBot: jest.fn(async () => true),
    isAddressingDifferentPersonality: jest.fn(async () => null),
    extractContent: jest.fn(async (m: any) => m.content)
  }
}));
jest.mock('../src/services/personality', () => ({
  personalityService: {
    getSystemPrompt: jest.fn(async () => 'You are a test bot.'),
    getErrorMessage: jest.fn(async () => 'err'),
    getCooldownMessage: jest.fn(async () => 'cool')
  }
}));
jest.mock('../src/services/personalityManager', () => ({
  getPersonalityManager: () => ({ getActiveCharacter: async () => ({ name: 'Bot Kun' }) })
}));
jest.mock('../src/services/memory', () => ({
  memoryService: {
    rememberIdentity: jest.fn(), getOrCreateProfile: jest.fn(async () => ({ memoryEligible: false })),
    updateMemoryEligibility: jest.fn(), updateLastInteraction: jest.fn(),
    getIdentityMemories: jest.fn(async () => []), formatMemoriesForAI: jest.fn(() => '')
  }
}));
jest.mock('../src/services/memoryExtraction', () => ({ memoryExtractionService: { setAIService: jest.fn(), extractMemories: jest.fn() } }));
jest.mock('../src/services/nickname', () => ({ initNicknameService: jest.fn(), getNicknameService: jest.fn() }));
jest.mock('../src/services/confession', () => ({
  initConfessionService: jest.fn(),
  getConfessionService: () => ({ getActiveSession: async () => null })
}));
jest.mock('../src/services/confessionBoothConversation', () => ({
  initConfessionBoothConversationService: jest.fn(),
  getConfessionBoothConversationService: jest.fn()
}));
jest.mock('../src/utils/discordMedia', () => ({
  ...jest.requireActual('../src/utils/discordMedia'),
  sleep: async () => undefined
}));

import { MessageRouter } from '../src/services/messageRouter';
import { memeService } from '../src/services/meme';
import { gifCopyService, gifLibrary } from '../src/services/gifCopy';
import { customEmojiService } from '../src/services/customEmoji';
import { responseMemoryService } from '../src/services/responseMemory';
import { recentMedia } from '../src/services/recentMedia';
import { conversationContextService } from '../src/services/conversationContext';

const MIN = 60 * 1000;
let counter = 0;

function guildEmojis() {
  const list = Array.from({ length: 8 }, (_, i) => ({
    id: `5000000000000000${String(i).padStart(2, '0')}`, name: `party${i}`, animated: false,
    available: true, roles: { cache: { size: 0 } }
  }));
  return { cache: new Map(list.map(e => [e.id, e])) };
}

function fakeMessage(content: string, channelId = 'c1') {
  counter += 1;
  const channelSend = jest.fn(async () => undefined);
  const reply = jest.fn(async () => undefined);
  const message: any = {
    id: `m${counter}`, content, channelId, reference: null,
    author: { id: `u${counter}`, bot: false, globalName: 'Tester', displayName: 'Tester' },
    guild: { id: 'g1', emojis: guildEmojis(), members: { fetch: async () => ({}) } },
    channel: { sendTyping: jest.fn(async () => undefined), isSendable: () => true, send: channelSend, nsfw: false, messages: { fetch: async () => ({}) } },
    attachments: new Map(), embeds: [], mentions: { users: new Map() },
    reply
  };
  return { message, reply, channelSend };
}

const ok = (content: string) => ({ success: true, content });

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-12T12:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
  mockGenerate.mockReset();
  memeService.clearAll();
  gifCopyService.clear();
  customEmojiService.clear();
  responseMemoryService.clearMemory();
  recentMedia.clear();
  conversationContextService.shutdown?.();
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('MessageRouter flow', () => {
  it('turns an offered :name: into a real server emoji, at most one', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01); // the emoji offer happens
    mockGenerate.mockImplementation(async (req: any) => {
      const names: string[] = (req.emojiContext?.match(/:(\w+):/g) ?? []);
      return ok(`lol that is great ${names[0]} ${names[1]}`);
    });

    const router = new MessageRouter();
    const { message, reply } = fakeMessage('hey bot');
    await router.handleMessage(message, 'bot');

    const sent = reply.mock.calls[0][0].content as string;
    expect(sent).toMatch(/<:party\d:5\d+>/);
    expect((sent.match(/<:/g) ?? []).length).toBe(1);
    expect(mockGenerate.mock.calls[0][0].emojiContext).toContain('custom emojis');
  });

  it('removes a made-up custom emoji when none was offered', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99); // no offer this time
    mockGenerate.mockResolvedValue(ok('sure <:made_up:999999999999999999> thing'));
    const router = new MessageRouter();
    const { message, reply } = fakeMessage('hey bot');
    await router.handleMessage(message, 'bot');
    expect(reply.mock.calls[0][0].content).toBe('sure thing');
    expect(mockGenerate.mock.calls[0][0].emojiContext).toBeUndefined();
  });

  it('asks again when it is about to repeat itself in the same channel', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const router = new MessageRouter();

    mockGenerate.mockResolvedValueOnce(ok('nah that is not happening bro'));
    const first = fakeMessage('can you do it');
    await router.handleMessage(first.message, 'bot');

    mockGenerate
      .mockResolvedValueOnce(ok('nah that is not happening bro'))      // same again -> repeat
      .mockResolvedValueOnce(ok('maybe tomorrow, ask me later'));      // the retry
    const second = fakeMessage('please do it');
    await router.handleMessage(second.message, 'bot');

    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockGenerate.mock.calls[2][0].label).toBe('repeat-retry');
    expect(second.reply.mock.calls[0][0].content).toBe('maybe tomorrow, ask me later');
  });

  it('does not retry when the reply is new', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const router = new MessageRouter();
    mockGenerate.mockResolvedValueOnce(ok('first thing'));
    await router.handleMessage(fakeMessage('a').message, 'bot');
    mockGenerate.mockResolvedValueOnce(ok('something totally different here friend'));
    await router.handleMessage(fakeMessage('b').message, 'bot');
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('calling the bot makes THAT channel the next idle-meme channel; chatting elsewhere does not', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    mockGenerate.mockResolvedValue(ok('hi there'));
    const router = new MessageRouter();

    const { addressingService } = require('../src/services/addressing');
    (addressingService.isAddressingBot as jest.Mock).mockResolvedValueOnce(false);
    await router.handleMessage(fakeMessage('just chatting', 'general').message, 'bot'); // not addressed
    await router.handleMessage(fakeMessage('hey bot', 'karen-chat').message, 'bot');    // addressed

    jest.advanceTimersByTime(10 * MIN);
    expect(memeService.getDueIdleMemes()).toEqual([{ guildId: 'g1', channelId: 'karen-chat' }]);
  });

  it('collects a GIF from normal chat, then reuses it as its own when it fits the reply', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.45);
    const LAUGH = 'https://tenor.com/view/cat-laughing-gif-11111111';
    const { addressingService } = require('../src/services/addressing');
    const router = new MessageRouter();

    // 1) somebody posts a GIF in normal chat (bot not addressed)
    (addressingService.isAddressingBot as jest.Mock).mockResolvedValueOnce(false);
    await router.handleMessage(fakeMessage(`haha ${LAUGH}`, 'general').message, 'bot');
    await flush();
    expect(gifLibrary_size()).toBe(1);

    // 2) later the bot replies with something funny and is allowed to add a GIF
    jest.spyOn(router as any, 'shouldAttachMedia').mockReturnValue(true);
    mockGenerate.mockResolvedValue(ok('lmao that is hilarious'));
    const { message, reply, channelSend } = fakeMessage('tell me a joke', 'general');
    await router.handleMessage(message, 'bot');

    expect(reply.mock.calls[0][0].files).toBeUndefined();
    expect(channelSend).toHaveBeenCalledWith({ content: LAUGH, allowedMentions: { parse: [] } });

    // 3) and it never sends that same GIF again
    mockGenerate.mockResolvedValue(ok('lmao another hilarious one'));
    const again = fakeMessage('another one', 'general');
    await router.handleMessage(again.message, 'bot');
    expect(again.channelSend).not.toHaveBeenCalledWith({ content: LAUGH, allowedMentions: { parse: [] } });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
}

function gifLibrary_size(): number {
  return gifLibrary.size('g1');
}
