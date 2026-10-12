/**
 * Idle meme rules: one meme, in the channel where the bot was last called, after it went quiet.
 */

import { MemeService } from '../src/services/meme';
import { MEME_IDLE_AFTER_MS, MEME_IDLE_JITTER_MS, MEME_IDLE_SESSION_MAX_MS } from '../src/config';

const MIN = 60 * 1000;

describe('MemeService idle meme', () => {
  let now: number;
  let memeService: MemeService;

  beforeEach(() => {
    now = 1_000_000;
    // random() = 0 -> no extra jitter, so "quiet long enough" is exactly MEME_IDLE_AFTER_MS
    memeService = new MemeService(() => now, () => 0);
  });

  it('never drops a meme in a channel where the bot was not called', () => {
    memeService.noteActivity('g1', 'busy-channel');
    now += 60 * MIN;
    expect(memeService.getDueIdleMemes()).toEqual([]);
  });

  it('noteActivity never creates a session', () => {
    for (let i = 0; i < 50; i++) {
      memeService.noteActivity('g1', 'c1');
      now += 1000;
    }
    now += MEME_IDLE_AFTER_MS * 2;
    expect(memeService.getDueIdleMemes()).toEqual([]);
  });

  it('is due only after the channel has been quiet long enough', () => {
    memeService.markBotCalled('g1', 'c1');
    now += MEME_IDLE_AFTER_MS - 1;
    expect(memeService.getDueIdleMemes()).toEqual([]);
    now += 1;
    expect(memeService.getDueIdleMemes()).toEqual([{ guildId: 'g1', channelId: 'c1' }]);
  });

  it('keeps waiting while people keep chatting in that channel', () => {
    memeService.markBotCalled('g1', 'c1');
    now += MEME_IDLE_AFTER_MS - 1000;
    memeService.noteActivity('g1', 'c1');
    now += MEME_IDLE_AFTER_MS - 1000;
    expect(memeService.getDueIdleMemes()).toEqual([]);
    now += 1000;
    expect(memeService.getDueIdleMemes()).toHaveLength(1);
  });

  it('chatting in OTHER channels does not delay or move the meme', () => {
    memeService.markBotCalled('g1', 'called');
    now += MEME_IDLE_AFTER_MS - 1000;
    memeService.noteActivity('g1', 'other');
    now += 1000;
    expect(memeService.getDueIdleMemes()).toEqual([{ guildId: 'g1', channelId: 'called' }]);
  });

  it('drops only ONE meme per call, then stays silent', () => {
    memeService.markBotCalled('g1', 'c1');
    now += MEME_IDLE_AFTER_MS;
    expect(memeService.getDueIdleMemes()).toHaveLength(1);
    memeService.finishSession('g1');
    now += 10 * MIN;
    expect(memeService.getDueIdleMemes()).toEqual([]);
    now += 5 * 60 * MIN;
    expect(memeService.getDueIdleMemes()).toEqual([]);
  });

  it('calling the bot again re-arms it, in the NEW channel', () => {
    memeService.markBotCalled('g1', 'c1');
    now += MEME_IDLE_AFTER_MS;
    memeService.finishSession('g1');

    memeService.markBotCalled('g1', 'c2');
    now += MEME_IDLE_AFTER_MS;
    expect(memeService.getDueIdleMemes()).toEqual([{ guildId: 'g1', channelId: 'c2' }]);
  });

  it('ignores a call that is too old', () => {
    memeService.markBotCalled('g1', 'c1');
    memeService.noteActivity('g1', 'c1');
    now += MEME_IDLE_SESSION_MAX_MS + 1;
    expect(memeService.getDueIdleMemes()).toEqual([]);
  });

  it('adds a random extra wait so it feels human', () => {
    const jittery = new MemeService(() => now, () => 0.999);
    jittery.markBotCalled('g1', 'c1');
    now += MEME_IDLE_AFTER_MS;
    expect(jittery.getDueIdleMemes()).toEqual([]);
    now += MEME_IDLE_JITTER_MS;
    expect(jittery.getDueIdleMemes()).toHaveLength(1);
  });

  it('keeps servers separate', () => {
    memeService.markBotCalled('g1', 'c1');
    now += MEME_IDLE_AFTER_MS;
    memeService.markBotCalled('g2', 'c9');
    expect(memeService.getDueIdleMemes()).toEqual([{ guildId: 'g1', channelId: 'c1' }]);
  });
});
