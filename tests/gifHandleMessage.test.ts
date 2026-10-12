/**
 * End-to-end check of the GIF collector + copycat with a fake Discord message.
 */

jest.mock('../src/services/featureToggle', () => ({ featureToggleService: { isEnabled: jest.fn(async () => true) } }));
jest.mock('../src/utils/discordMedia', () => ({
  ...jest.requireActual('../src/utils/discordMedia'),
  sleep: async () => undefined
}));

import { GifCopyService, GifLibrary } from '../src/services/gifCopy';
import { RecentMediaTracker } from '../src/services/recentMedia';

const LAUGH = 'https://tenor.com/view/cat-laughing-gif-11111111';

function build(random = () => 0) {
  const media = new RecentMediaTracker();
  const library = new GifLibrary(null);
  return { service: new GifCopyService(library, media, Date.now, random), library, media };
}

let idCounter = 0;
function fakeMessage(content: string, over: { nsfw?: boolean; deleted?: boolean; userId?: string; channelId?: string } = {}) {
  idCounter += 1;
  const send = jest.fn(async () => undefined);
  const channel: any = {
    nsfw: over.nsfw ?? false,
    isSendable: () => true,
    send,
    messages: { fetch: jest.fn(async () => { if (over.deleted) throw new Error('Unknown Message'); return {}; }) }
  };
  const message: any = {
    id: `m${idCounter}`,
    content,
    guild: { id: 'g1' },
    channelId: over.channelId ?? 'c1',
    channel,
    author: { id: over.userId ?? 'u1' },
    attachments: new Map(),
    embeds: []
  };
  return { message, send };
}

describe('GifCopyService.handleMessage', () => {
  it('copies the same GIF as a plain message and remembers it', async () => {
    const { service, library } = build();
    const { message, send } = fakeMessage(`lol ${LAUGH}`);
    await service.handleMessage(message, false);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ content: LAUGH, allowedMentions: { parse: [] } });
    expect(library.size('g1')).toBe(1);
  });

  it('does not post the same GIF again right after', async () => {
    const { service } = build();
    const first = fakeMessage(LAUGH);
    await service.handleMessage(first.message, false);
    const second = fakeMessage(LAUGH, { userId: 'u2', channelId: 'c2' });
    await service.handleMessage(second.message, false);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
  });

  it('copies at most once per channel cooldown', async () => {
    const { service } = build();
    const first = fakeMessage(LAUGH);
    await service.handleMessage(first.message, false);
    const second = fakeMessage('https://tenor.com/view/sad-dog-gif-22222222', { userId: 'u2' });
    await service.handleMessage(second.message, false);
    expect(second.send).not.toHaveBeenCalled();
  });

  it('stays quiet in age-restricted channels, for addressed messages and when the original was deleted', async () => {
    const nsfw = fakeMessage(LAUGH, { nsfw: true });
    await build().service.handleMessage(nsfw.message, false);
    expect(nsfw.send).not.toHaveBeenCalled();

    const addressed = fakeMessage(LAUGH);
    await build().service.handleMessage(addressed.message, true);
    expect(addressed.send).not.toHaveBeenCalled();

    const deleted = fakeMessage(LAUGH, { deleted: true });
    await build().service.handleMessage(deleted.message, false);
    expect(deleted.send).not.toHaveBeenCalled();
  });

  it('does nothing (and never throws) for normal chat and for failures', async () => {
    const { service } = build();
    const chat = fakeMessage('hello everyone');
    await expect(service.handleMessage(chat.message, false)).resolves.toBeUndefined();
    expect(chat.send).not.toHaveBeenCalled();

    const broken = fakeMessage(LAUGH);
    broken.message.channel.send = jest.fn(async () => { throw new Error('Missing Permissions'); });
    await expect(service.handleMessage(broken.message, false)).resolves.toBeUndefined();
  });

  it('reuses a collected GIF later, only when it fits what the bot says', async () => {
    const { service } = build(() => 0.99); // never copy right now, only collect
    await service.handleMessage(fakeMessage(`haha ${LAUGH}`).message, false);

    expect((await service.pickForReply('g1', ['lmao thats so funny']))?.url).toBe(LAUGH);
    service.recordPosted('g1', 'c1', null, LAUGH, false);
    expect(await service.pickForReply('g1', ['lmao thats so funny'])).toBeNull(); // not twice
  });
});
