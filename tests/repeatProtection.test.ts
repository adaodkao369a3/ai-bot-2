import { RecentMediaTracker, normalizeMediaKey } from '../src/services/recentMedia';
import { VarietyPicker } from '../src/services/variety';
import { ResponseMemoryService } from '../src/services/responseMemory';

describe('RecentMediaTracker', () => {
  it('treats the same link with a different query string as the same item', () => {
    expect(normalizeMediaKey('https://cdn.x.com/a/b.gif?ex=1&hm=2')).toBe(normalizeMediaKey('https://cdn.x.com/a/b.gif?ex=9'));
  });

  it('remembers items per scope and forgets them after the time limit', () => {
    let now = 0;
    const tracker = new RecentMediaTracker(10, 1000, () => now);
    tracker.add('gif:g1', 'https://a.com/1.gif');
    expect(tracker.has('gif:g1', 'https://a.com/1.gif')).toBe(true);
    expect(tracker.has('gif:g2', 'https://a.com/1.gif')).toBe(false);
    now = 1001;
    expect(tracker.has('gif:g1', 'https://a.com/1.gif')).toBe(false);
  });

  it('keeps only the newest items beyond the size limit', () => {
    const tracker = new RecentMediaTracker(2, 10_000, () => 0);
    ['a', 'b', 'c'].forEach(x => tracker.add('s', `https://x.com/${x}`));
    expect(tracker.has('s', 'https://x.com/a')).toBe(false);
    expect(tracker.has('s', 'https://x.com/c')).toBe(true);
  });
});

describe('VarietyPicker', () => {
  it('never picks the same line twice in a row', () => {
    const picker = new VarietyPicker();
    const options = ['a', 'b', 'c', 'd'];
    let previous = '';
    for (let i = 0; i < 200; i++) {
      const choice = picker.pick('s', options, 1);
      expect(choice).not.toBe(previous);
      previous = choice;
    }
  });

  it('works with a single option', () => {
    expect(new VarietyPicker().pick('s', ['only'])).toBe('only');
  });
});

describe('ResponseMemoryService', () => {
  it('spots a repeated reply in the same channel, ignoring emoji and punctuation', () => {
    const memory = new ResponseMemoryService();
    memory.addResponse('lmao no way 💀', 'c1');
    expect(memory.isTooSimilar('Lmao no way!', 'c1')).toBe(true);
    expect(memory.isTooSimilar('Lmao no way!', 'c2')).toBe(false);
  });

  it('does not flag different replies', () => {
    const memory = new ResponseMemoryService();
    memory.addResponse('lmao no way', 'c1');
    expect(memory.isTooSimilar('that sounds like a plan to me honestly', 'c1')).toBe(false);
  });
});
