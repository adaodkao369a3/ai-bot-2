import {
  extractGifFromMessage,
  slugWordsFromUrl,
  slugWordsFromName,
  isPersistentGifUrl,
  contentWords,
  scoreGif,
  stem
} from '../src/services/gifContext';

const empty = { attachments: [], embeds: [] };

describe('extractGifFromMessage', () => {
  it('finds a Tenor link and reads the description at the end of it', () => {
    const gif = extractGifFromMessage({ content: 'lol https://tenor.com/view/gojo-satoru-laughing-gif-27120473', ...empty });
    expect(gif?.url).toBe('https://tenor.com/view/gojo-satoru-laughing-gif-27120473');
    expect(gif?.slugWords).toEqual(expect.arrayContaining(['gojo', 'satoru', 'laugh']));
    expect(gif?.persistent).toBe(true);
    expect(gif?.source).toBe('link');
  });

  it('finds a Giphy link and ignores the id', () => {
    const gif = extractGifFromMessage({ content: 'https://giphy.com/gifs/anime-cat-vibing-3o7TKsQ8mXjhZ1abcd', ...empty });
    expect(gif?.slugWords).toEqual(expect.arrayContaining([stem('anime'), 'cat', 'vib']));
    expect(gif?.slugWords.join(' ')).not.toMatch(/3o7/);
  });

  it('finds a direct .gif link and strips trailing punctuation', () => {
    const gif = extractGifFromMessage({ content: 'look (https://example.com/a/funny-dog.gif).', ...empty });
    expect(gif?.url).toBe('https://example.com/a/funny-dog.gif');
  });

  it('finds an uploaded GIF but marks the expiring Discord link as not persistent', () => {
    const gif = extractGifFromMessage({
      content: '',
      attachments: [{ url: 'https://cdn.discordapp.com/attachments/1/2/cat_vibing.gif?ex=1&hm=2', name: 'cat_vibing.gif', contentType: 'image/gif' }],
      embeds: []
    });
    expect(gif?.source).toBe('attachment');
    expect(gif?.persistent).toBe(false);
    expect(gif?.slugWords).toEqual(expect.arrayContaining(['cat', 'vib']));
  });

  it('finds a gifv embed', () => {
    const gif = extractGifFromMessage({ content: 'x', attachments: [], embeds: [{ type: 'gifv', url: 'https://tenor.com/view/dance-gif-1234567890' }] });
    expect(gif?.source).toBe('embed');
  });

  it('returns null for text, normal links and non-GIF images', () => {
    expect(extractGifFromMessage({ content: 'hello there', ...empty })).toBeNull();
    expect(extractGifFromMessage({ content: 'https://youtube.com/watch?v=abc', ...empty })).toBeNull();
    expect(extractGifFromMessage({ content: '', attachments: [{ url: 'https://x/y.png', name: 'y.png', contentType: 'image/png' }], embeds: [] })).toBeNull();
  });
});

describe('words', () => {
  it('stems related forms to the same word', () => {
    expect(stem('laughing')).toBe(stem('laughs'));
    expect(stem('dancing')).toBe(stem('dance'));
    expect(stem('hugging')).toBe(stem('hug'));
  });

  it('drops stop words, numbers and link noise', () => {
    expect(contentWords('the gif 12345 tenor view')).toEqual([]);
  });

  it('reads file names', () => {
    expect(slugWordsFromName('sad_cat_crying.gif')).toEqual(expect.arrayContaining(['sad', 'cat', 'cry']));
  });

  it('tolerates garbage urls', () => {
    expect(slugWordsFromUrl('not a url')).toEqual([]);
    expect(isPersistentGifUrl('nope')).toBe(false);
  });
});

describe('scoreGif', () => {
  const laughingCat = { slug: slugWordsFromUrl('https://tenor.com/view/cat-laughing-gif-11111111'), context: [] as string[] };
  const sadDog = { slug: slugWordsFromUrl('https://tenor.com/view/sad-dog-crying-gif-22222222'), context: [] as string[] };

  it('matches the same mood even with different words ("lmao" vs "laughing")', () => {
    const query = contentWords('lmao that is so true');
    expect(scoreGif(laughingCat, query)).toBeGreaterThanOrEqual(3);
    expect(scoreGif(sadDog, query)).toBeLessThan(3);
  });

  it('matches shared topic words', () => {
    expect(scoreGif(sadDog, contentWords('my dog is the best'))).toBeGreaterThanOrEqual(3);
  });

  it('scores unrelated text as zero', () => {
    expect(scoreGif(laughingCat, contentWords('quarterly invoice schedule'))).toBe(0);
    expect(scoreGif(laughingCat, [])).toBe(0);
  });

  it('weak context words count less than description words', () => {
    const weak = { slug: [] as string[], context: contentWords('minecraft server') };
    expect(scoreGif(weak, contentWords('minecraft'))).toBe(1);
  });
});
