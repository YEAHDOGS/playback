import { describe, it, expect } from 'vitest';
import { DEMO_TRACKS } from './catalog.js';
import { PlaybackQueue } from './queue/PlaybackQueue.js';

// The demo catalog is the single source of truth for track ids: the
// libraries, the queue restore/prune path, and snapshot resolution all read
// it. If an id here drifts, restore() starts pruning tracks that exist.

describe('catalog', () => {
  it('should expose three streamable demo tracks with unique ids', () => {
    expect(DEMO_TRACKS).toHaveLength(3);
    const ids = DEMO_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of DEMO_TRACKS) {
      expect(typeof t.url).toBe('string');
      expect(t.url).toMatch(/^https:\/\//);
      expect(typeof t.title).toBe('string');
    }
  });

  it('should serve as the restore catalog: unknown saved ids get pruned', () => {
    const map = new Map();
    const storage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
    const q = new PlaybackQueue(storage);
    q.add(DEMO_TRACKS[0]);
    q.add({ id: 'ghost', title: 'Ghost', artist: 'Nobody', url: 'https://example.com/g.mp3' });

    const revived = new PlaybackQueue(storage);
    const result = revived.restore(DEMO_TRACKS);
    expect(result.restored).toBe(true);
    expect(result.dropped).toBe(1);
    expect(revived.items.map((t) => t.id)).toEqual([DEMO_TRACKS[0].id]);
  });
});
