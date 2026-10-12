import { GifLibrary, GifCopyService, GifStore, GifEntry } from '../src/services/gifCopy';
import { RecentMediaTracker } from '../src/services/recentMedia';
import { extractGifFromMessage } from '../src/services/gifContext';
import {
  GIF_COPY_CHANCE,
  GIF_COPY_CHANNEL_COOLDOWN_MS,
  GIF_COPY_USER_COOLDOWN_MS
} from '../src/config';

const gifOf = (url: string) => extractGifFromMessage({ content: url, attachments: [], embeds: [] })!;
const LAUGH = 'https://tenor.com/view/cat-laughing-gif-11111111';
const SAD = 'https://tenor.com/view/sad-dog-crying-gif-22222222';

function setup(random = () => 0) {
  let now = 1_000_000;
  const media = new RecentMediaTracker(300, 12 * 3600 * 1000, () => now);
  const library = new GifLibrary(null, 300, () => now);
  const service = new GifCopyService(library, media, () => now, random);
  return { service, library, media, advance: (ms: number) => { now += ms; } };
}

const moment = (url: string, over: Record<string, unknown> = {}) => ({
  guildId: 'g1', channelId: 'c1', userId: 'u1', gif: gifOf(url), text: '', isAddressingBot: false, ...over
});

describe('GifCopyService.process (when to copy)', () => {
  it('copies when the chance roll succeeds', async () => {
    const { service } = setup(() => 0); // 0 < GIF_COPY_CHANCE
    expect((await service.process(moment(LAUGH))).copy).toBe(true);
  });

  it('does not copy when the chance roll fails', async () => {
    const { service } = setup(() => GIF_COPY_CHANCE + 0.01);
    const result = await service.process(moment(LAUGH));
    expect(result).toEqual({ copy: false, reason: 'chance' });
  });

  it('still remembers the GIF even when it does not copy it', async () => {
    const { service, library } = setup(() => 0.99);
    await service.process(moment(LAUGH));
    expect(library.size('g1')).toBe(1);
  });

  it('never copies a message that spoke to the bot', async () => {
    const { service } = setup();
    expect((await service.process(moment(LAUGH, { isAddressingBot: true }))).reason).toBe('bot was addressed');
  });

  it('never copies messages without a GIF', async () => {
    const { service } = setup();
    expect((await service.process({ ...moment(LAUGH), gif: null })).copy).toBe(false);
  });

  it('respects the channel and user cooldowns', async () => {
    const { service, advance } = setup();
    expect((await service.process(moment(LAUGH))).copy).toBe(true);
    service.recordPosted('g1', 'c1', 'u1', LAUGH, true);

    // different GIF, same channel, right away
    expect((await service.process(moment(SAD, { userId: 'u2' }))).reason).toBe('channel cooldown');

    // channel free again but same user is still on cooldown
    advance(GIF_COPY_CHANNEL_COOLDOWN_MS + 1);
    expect((await service.process(moment(SAD))).reason).toBe('user cooldown');

    advance(GIF_COPY_USER_COOLDOWN_MS);
    expect((await service.process(moment(SAD))).copy).toBe(true);
  });

  it('never copies a GIF it posted recently', async () => {
    const { service } = setup();
    service.recordPosted('g1', 'c1', null, LAUGH, false);
    expect((await service.process(moment(LAUGH))).reason).toBe('posted recently');
    // ...also when only the query string differs
    expect((await service.process(moment(`${LAUGH}?x=1`))).reason).toBe('posted recently');
  });

  it('does not save expiring Discord upload links', async () => {
    const { service, library } = setup();
    const upload = extractGifFromMessage({
      content: '', embeds: [],
      attachments: [{ url: 'https://cdn.discordapp.com/attachments/1/2/a.gif?ex=1&hm=2', name: 'a.gif', contentType: 'image/gif' }]
    })!;
    await service.process({ ...moment(LAUGH), gif: upload });
    expect(library.size('g1')).toBe(0);
  });
});

describe('GifCopyService.pickForReply (reuse a GIF that fits)', () => {
  async function loaded() {
    const ctx = setup();
    await ctx.service.process(moment(LAUGH));
    await ctx.service.process(moment(SAD, { channelId: 'c2', userId: 'u2' }));
    return ctx;
  }

  it('picks the GIF whose meaning fits the reply', async () => {
    const { service } = await loaded();
    expect((await service.pickForReply('g1', ['lmao that is hilarious']))?.url).toBe(LAUGH);
    expect((await service.pickForReply('g1', ['aww dont cry buddy']))?.url).toBe(SAD);
  });

  it('picks nothing when nothing fits', async () => {
    const { service } = await loaded();
    expect(await service.pickForReply('g1', ['please file the quarterly invoice'])).toBeNull();
  });

  it('never picks a GIF that was posted recently', async () => {
    const { service } = await loaded();
    service.recordPosted('g1', 'c1', null, LAUGH, false);
    expect(await service.pickForReply('g1', ['lmao that is hilarious'])).toBeNull();
  });

  it('keeps servers separate', async () => {
    const { service } = await loaded();
    expect(await service.pickForReply('other-guild', ['lmao'])).toBeNull();
  });

  it('uses words typed with the GIF as a weaker hint', async () => {
    const { service } = setup();
    await service.process(moment('https://tenor.com/view/cool-gif-33333333', { text: 'minecraft minecraft server creeper' }));
    // one weak word is not enough...
    expect(await service.pickForReply('g1', ['minecraft'])).toBeNull();
    // ...several are
    expect((await service.pickForReply('g1', ['minecraft server creeper']))?.url).toContain('cool-gif');
  });
});

describe('GifLibrary storage', () => {
  it('keeps only the newest entries per server', async () => {
    const library = new GifLibrary(null, 3);
    for (let i = 0; i < 6; i++) {
      await library.remember('g1', gifOf(`https://tenor.com/view/thing-${i}-gif-1000000${i}`), []);
    }
    expect(library.size('g1')).toBe(3);
  });

  it('survives a broken database by working from memory', async () => {
    const broken: GifStore = {
      load: async () => { throw new Error('relation "gif_library" does not exist'); },
      save: async () => { throw new Error('nope'); },
      prune: async () => { throw new Error('nope'); }
    };
    const library = new GifLibrary(broken, 300);
    await library.remember('g1', gifOf(LAUGH), ['hi']);
    expect(await library.all('g1')).toHaveLength(1);
  });

  it('loads saved entries from the store and saves new ones', async () => {
    const saved: GifEntry[] = [];
    const store: GifStore = {
      load: async () => [{ url: SAD, key: 'tenor.com/view/sad-dog-crying-gif-22222222', slug: ['sad', 'dog', 'cry'], context: [], timesSeen: 1, timesUsed: 0, lastUsedAt: null, updatedAt: 1 }],
      save: async (_g, entry) => { saved.push(entry); },
      prune: async () => undefined
    };
    const library = new GifLibrary(store, 300);
    await library.remember('g1', gifOf(LAUGH), []);
    expect(library.size('g1')).toBe(2);
    await new Promise(resolve => setImmediate(resolve));
    expect(saved.some(entry => entry.url === LAUGH)).toBe(true);
  });
});
