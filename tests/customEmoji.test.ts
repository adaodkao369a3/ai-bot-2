import { CustomEmojiService, GuildEmoji, toShortcodes } from '../src/services/customEmoji';
import {
  CUSTOM_EMOJI_OFFER_COUNT,
  CUSTOM_EMOJI_MIN_REPLY_GAP,
  CUSTOM_EMOJI_REUSE_COOLDOWN_MS,
  MAX_EMOJI_PER_REPLY
} from '../src/config';

const emojis: GuildEmoji[] = Array.from({ length: 12 }, (_, i) => ({
  id: `1000000000000000${String(i).padStart(2, '0')}`,
  name: `emo${i}`,
  animated: i === 3
}));
const token = (e: GuildEmoji) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;

function make(random = () => 0) {
  let now = 1_000_000;
  const service = new CustomEmojiService(() => now, random);
  return { service, advance: (ms: number) => { now += ms; } };
}

describe('CustomEmojiService.offer', () => {
  it('offers a handful of emojis for a reply', () => {
    const { service } = make();
    const offer = service.offer('g', 'c', emojis);
    expect(offer?.emojis).toHaveLength(CUSTOM_EMOJI_OFFER_COUNT);
    expect(offer?.promptText).toContain(':emo');
  });

  it('offers nothing when the server has no emojis', () => {
    expect(make().service.offer('g', 'c', [])).toBeNull();
  });

  it('offers only some of the time', () => {
    expect(make(() => 0.99).service.offer('g', 'c', emojis)).toBeNull();
  });

  it('waits a few replies after using one', () => {
    const { service } = make();
    const first = service.offer('g', 'c', emojis)!;
    service.process(`nice ${`:${first.emojis[0].name}:`}`, 'c', 'g', first);
    for (let i = 0; i < CUSTOM_EMOJI_MIN_REPLY_GAP; i++) {
      expect(service.offer('g', 'c', emojis)).toBeNull();
      service.process('plain reply', 'c', 'g', null);
    }
    expect(service.offer('g', 'c', emojis)).not.toBeNull();
  });

  it('does not offer emojis used recently, so it rotates', () => {
    const { service, advance } = make();
    const used = new Set<string>();
    for (let round = 0; round < 6; round++) {
      advance(CUSTOM_EMOJI_REUSE_COOLDOWN_MS * 2);
      for (let i = 0; i < CUSTOM_EMOJI_MIN_REPLY_GAP; i++) service.process('x', 'c', 'g', null);
      const offer = service.offer('g', 'c', emojis)!;
      const pick = offer.emojis[0];
      expect(used.has(pick.id)).toBe(false);
      used.add(pick.id);
      service.process(`ok :${pick.name}:`, 'c', 'g', offer);
    }
  });
});

describe('CustomEmojiService.process', () => {
  it('turns :name: into the real emoji', () => {
    const { service } = make();
    const offer = service.offer('g', 'c', emojis)!;
    const e = offer.emojis[0];
    expect(service.process(`lol :${e.name}:`, 'c', 'g', offer).text).toBe(`lol ${token(e)}`);
  });

  it('writes animated emojis with the a: prefix', () => {
    const { service } = make();
    const offer = { emojis: [emojis[3]], promptText: '' };
    expect(service.process(`hey :${emojis[3].name}:`, 'c', 'g', offer).text).toContain('<a:emo3:');
  });

  it('removes made-up or not-offered emojis', () => {
    const { service } = make();
    const offer = service.offer('g', 'c', emojis)!;
    const notOffered = emojis.find(e => !offer.emojis.includes(e))!;
    const out = service.process(`hi ${token(notOffered)} :fake_emoji:`, 'c', 'g', offer).text;
    expect(out).not.toContain(notOffered.id);
  });

  it('removes any custom emoji when none was offered', () => {
    const { service } = make();
    expect(service.process(`hi ${token(emojis[0])}`, 'c', 'g', null).text).toBe('hi');
  });

  it('allows at most one custom emoji', () => {
    const { service } = make();
    const offer = service.offer('g', 'c', emojis)!;
    const [a, b] = offer.emojis;
    const out = service.process(`:${a.name}: and :${b.name}:`, 'c', 'g', offer).text;
    expect((out.match(/<a?:/g) ?? []).length).toBe(1);
  });

  it('allows at most two emojis in total', () => {
    const { service } = make();
    const out = service.process('a 😂 b 💀 c 😭 d 🔥', 'c', 'g', null).text;
    const count = (out.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    expect(count).toBeLessThanOrEqual(MAX_EMOJI_PER_REPLY);
  });

  it('does not reuse a normal emoji from the last few replies in the same channel', () => {
    const { service } = make();
    expect(service.process('lol 💀', 'c', 'g', null).text).toContain('💀');
    expect(service.process('again 💀', 'c', 'g', null).text).toBe('again');
    // a different channel is not affected
    expect(service.process('other 💀', 'c2', 'g', null).text).toContain('💀');
  });

  it('keeps an emoji-only reply instead of sending nothing', () => {
    const { service } = make();
    service.process('💀', 'c', 'g', null);
    expect(service.process('💀', 'c', 'g', null).text).toBe('💀');
  });

  it('leaves normal text, times and punctuation alone', () => {
    const { service } = make();
    expect(service.process('meet at 10:30:45, ok?', 'c', 'g', null).text).toBe('meet at 10:30:45, ok?');
  });
});

describe('toShortcodes', () => {
  it('shortens custom emojis for chat history', () => {
    expect(toShortcodes('hi <:kekw:123456789012345678> <a:wave:223456789012345678>')).toBe('hi :kekw: :wave:');
  });
});
