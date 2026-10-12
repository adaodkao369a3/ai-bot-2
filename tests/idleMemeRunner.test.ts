/**
 * End-to-end check of the idle meme: real MemeService + real runner, fake Discord and fake meme API.
 */

jest.mock('../src/services/botState', () => ({ botStateService: { isEnabled: jest.fn(async () => true) } }));
jest.mock('../src/services/channelRestrictions', () => ({ channelRestrictionsService: { isChannelAllowed: jest.fn(async () => true) } }));
jest.mock('../src/services/featureToggle', () => ({ featureToggleService: { isEnabled: jest.fn(async () => true) } }));
jest.mock('../src/services/confession', () => ({ getConfessionService: () => ({ getActiveSession: async () => null }) }));
jest.mock('../src/utils/discordMedia', () => ({
  ...jest.requireActual('../src/utils/discordMedia'),
  sleep: async () => undefined
}));

import { runIdleMemeCheck } from '../src/services/idleMeme';
import { memeService } from '../src/services/meme';
import { recentMedia } from '../src/services/recentMedia';
import { featureToggleService } from '../src/services/featureToggle';

const MIN = 60 * 1000;

function fakeChannel(overrides: Record<string, unknown> = {}) {
  return {
    isTextBased: () => true,
    isThread: () => false,
    nsfw: false,
    permissionsFor: () => ({ has: () => true }),
    sendTyping: jest.fn(async () => undefined),
    send: jest.fn(async () => undefined),
    ...overrides
  };
}

function fakeClient(channels: Record<string, ReturnType<typeof fakeChannel>>) {
  return {
    user: { id: 'bot' },
    guilds: { cache: new Map([['g1', { channels: { cache: new Map(Object.entries(channels)) } }]]) }
  } as any;
}

let memeCounter: number;
function mockMemeApi(unique = true) {
  global.fetch = jest.fn(async (url: any, opts?: any) => {
    if (opts?.method === 'HEAD') {
      return { ok: true, headers: { get: () => 'image/jpeg' } } as any;
    }
    memeCounter += 1;
    const n = unique ? memeCounter : 1;
    return {
      ok: true,
      json: async () => ({ title: `meme ${n}`, url: `https://i.redd.it/meme${n}.jpg`, postLink: 'x', subreddit: 'memes' })
    } as any;
  }) as any;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-12T12:00:00Z') });
  memeService.clearAll();
  recentMedia.clear();
  memeCounter = 0;
  (featureToggleService.isEnabled as jest.Mock).mockResolvedValue(true);
  mockMemeApi();
});

afterEach(() => jest.useRealTimers());

describe('idle meme (end to end)', () => {
  it('drops exactly ONE plain-image meme, in the channel where the bot was called, after it went quiet', async () => {
    const called = fakeChannel();
    const busyOther = fakeChannel();
    const client = fakeClient({ called, busyOther });

    memeService.markBotCalled('g1', 'called');           // someone talks to the bot in #called ...
    for (let i = 0; i < 10; i++) {                       // ... and #busyOther is very active
      jest.advanceTimersByTime(30 * 1000);
      memeService.noteActivity('g1', 'busyOther');
    }

    await runIdleMemeCheck(client);                      // ~5 min later: not quiet long enough yet? (5 min exactly + jitter)
    expect(called.send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(8 * MIN);                   // quiet for > 5 min + max jitter
    await runIdleMemeCheck(client);

    expect(called.send).toHaveBeenCalledTimes(1);
    expect(busyOther.send).not.toHaveBeenCalled();

    const payload = (called.send as jest.Mock).mock.calls[0][0];
    expect(payload.embeds).toBeUndefined();              // not an embed
    expect(payload.content).toBeUndefined();             // no caption
    expect(payload.files[0].attachment).toMatch(/^https:\/\/i\.redd\.it\/meme\d+\.jpg$/);
    expect(payload.files[0].name).toBe('meme.jpg');
    expect(payload.allowedMentions).toEqual({ parse: [] });

    // ...and then nothing more, however long it stays quiet
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(10 * MIN);
      await runIdleMemeCheck(client);
    }
    expect(called.send).toHaveBeenCalledTimes(1);
  });

  it('never posts in a channel where the bot was never called', async () => {
    const quietChannel = fakeChannel();
    const client = fakeClient({ quietChannel });
    memeService.noteActivity('g1', 'quietChannel');
    jest.advanceTimersByTime(3 * 60 * MIN);
    await runIdleMemeCheck(client);
    expect(quietChannel.send).not.toHaveBeenCalled();
  });

  it('a new call moves the next meme to the new channel', async () => {
    const a = fakeChannel();
    const b = fakeChannel();
    const client = fakeClient({ a, b });

    memeService.markBotCalled('g1', 'a');
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(client);
    expect(a.send).toHaveBeenCalledTimes(1);

    memeService.markBotCalled('g1', 'b');
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(client);
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(a.send).toHaveBeenCalledTimes(1);
  });

  it('never repeats a meme it already posted', async () => {
    mockMemeApi(false); // the API keeps returning the SAME meme
    const channel = fakeChannel();
    const client = fakeClient({ channel });

    memeService.markBotCalled('g1', 'channel');
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(client);
    expect(channel.send).toHaveBeenCalledTimes(1);

    memeService.markBotCalled('g1', 'channel');
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(client);
    expect(channel.send).toHaveBeenCalledTimes(1); // nothing new to post, so it stays quiet
  });

  it('respects the meme feature toggle, NSFW channels and missing permissions, and does not retry', async () => {
    const nsfw = fakeChannel({ nsfw: true });
    const noPerms = fakeChannel({ permissionsFor: () => ({ has: () => false }) });
    for (const [name, channel] of [['nsfw', nsfw], ['noPerms', noPerms]] as const) {
      const client = fakeClient({ [name]: channel });
      memeService.markBotCalled('g1', name);
      jest.advanceTimersByTime(8 * MIN);
      await runIdleMemeCheck(client);
      expect(channel.send).not.toHaveBeenCalled();
    }

    const off = fakeChannel();
    (featureToggleService.isEnabled as jest.Mock).mockResolvedValue(false);
    memeService.markBotCalled('g1', 'off');
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(fakeClient({ off }));
    (featureToggleService.isEnabled as jest.Mock).mockResolvedValue(true);
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(fakeClient({ off }));
    expect(off.send).not.toHaveBeenCalled(); // session was finished, no later retry
  });

  it('falls back to the plain link if the upload fails', async () => {
    const channel = fakeChannel();
    (channel.send as jest.Mock).mockRejectedValueOnce(new Error('too large'));
    memeService.markBotCalled('g1', 'channel');
    jest.advanceTimersByTime(8 * MIN);
    await runIdleMemeCheck(fakeClient({ channel }));
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect((channel.send as jest.Mock).mock.calls[1][0].content).toMatch(/^https:\/\/i\.redd\.it\//);
  });
});
