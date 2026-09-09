import { describe, it, expect, beforeEach } from 'vitest';
import { PlaybackQueue, QUEUE_STORAGE_KEY, QUEUE_SCHEMA_VERSION, snapshotTrack } from './PlaybackQueue.js';

// In-memory Storage stand-in — exercises the real PlaybackQueue
// serialization path without touching the browser.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const track = (id, extra = {}) => ({
  id,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  url: `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${id}.mp3`,
  ...extra,
});

let storage;
let queue;
beforeEach(() => {
  storage = makeStorage();
  queue = new PlaybackQueue(storage);
});

describe('PlaybackQueue add/remove/reorder/clear', () => {
  it('should start empty with index -1 and no current track', () => {
    expect(queue.isEmpty).toBe(true);
    expect(queue.length).toBe(0);
    expect(queue.current()).toBeNull();
    expect(queue.index).toBe(-1);
  });

  it('should add tracks, point at the first one, and ignore duplicate ids', () => {
    expect(queue.add(track(1))).toBe(true);
    expect(queue.add(track(2))).toBe(true);
    expect(queue.add(track(1))).toBe(false); // duplicate id
    expect(queue.length).toBe(2);
    expect(queue.index).toBe(0);
    expect(queue.current().id).toBe('1');
  });

  it('should insert play-next right after the current track', () => {
    queue.add(track(1));
    queue.add(track(2));
    expect(queue.addNext(track(9))).toBe(true);
    expect(queue.items.map((t) => t.id)).toEqual(['1', '9', '2']);
    expect(queue.current().id).toBe('1'); // pointer stays on the same track
  });

  it('should keep the current-track pointer on the same track when removing an earlier one', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    queue.setIndex(1); // current = track 2
    const removed = queue.removeAt(0);
    expect(removed.id).toBe('1');
    expect(queue.items.map((t) => t.id)).toEqual(['2', '3']);
    expect(queue.current().id).toBe('2');
  });

  it('should advance the pointer when the current track itself is removed', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    queue.setIndex(1);
    queue.removeAt(1);
    expect(queue.items.map((t) => t.id)).toEqual(['1', '3']);
    expect(queue.current().id).toBe('3');
  });

  it('should reset to empty state on clear', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.clear();
    expect(queue.isEmpty).toBe(true);
    expect(queue.current()).toBeNull();
    expect(queue.index).toBe(-1);
  });

  it('should move a track and keep the pointer on the same track', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    queue.setIndex(0); // current = track 1
    expect(queue.move(0, 2)).toBe(true);
    expect(queue.items.map((t) => t.id)).toEqual(['2', '3', '1']);
    expect(queue.current().id).toBe('1');
    expect(queue.index).toBe(2);
  });

  it('should reject out-of-range moves and track an untouched order', () => {
    queue.add(track(1));
    queue.add(track(2));
    expect(queue.move(0, 0)).toBe(false);
    expect(queue.items.map((t) => t.id)).toEqual(['1', '2']);
    expect(queue.removeAt(5)).toBeNull();
  });

  it('should step next/prev through the queue and null out at the ends', () => {
    queue.add(track(1));
    queue.add(track(2));
    expect(queue.next().id).toBe('2');
    expect(queue.next()).toBeNull();
    expect(queue.prev().id).toBe('1');
    expect(queue.prev()).toBeNull();
  });

  it('should reset the saved position when the current track changes', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.setPosition(42.5);
    expect(queue.position).toBeCloseTo(42.5, 5);
    queue.next();
    expect(queue.position).toBe(0);
  });

  it('should reject non-finite positions without poisoning state', () => {
    queue.add(track(1));
    queue.setPosition(10);
    expect(queue.setPosition(NaN)).toBe(false);
    expect(queue.setPosition(Infinity)).toBe(false);
    expect(queue.position).toBe(10);
  });
});

describe('PlaybackQueue persistence round-trip', () => {
  it('should save on every mutation and survive a reload via a fresh instance', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    queue.setIndex(1);
    queue.setPosition(77.25);

    const revived = new PlaybackQueue(storage);
    const result = revived.restore([track(1), track(2), track(3)]);
    expect(result.restored).toBe(true);
    expect(result.dropped).toBe(0);
    expect(revived.items.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(revived.index).toBe(1);
    expect(revived.position).toBeCloseTo(77.25, 5);
    expect(revived.current().id).toBe('2');
  });

  it('should write the versioned storage key as JSON', () => {
    queue.add(track(1));
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(QUEUE_SCHEMA_VERSION);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.index).toBe(0);
  });
});

describe('PlaybackQueue stale-track pruning', () => {
  it('should drop stored entries whose id is no longer in the catalog', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(9));
    queue.setIndex(2);

    const revived = new PlaybackQueue(storage);
    const result = revived.restore([track(1), track(2)]);
    expect(result.restored).toBe(true);
    expect(result.dropped).toBe(1); // track-9 gone from the catalog
    expect(revived.items.map((t) => t.id)).toEqual(['1', '2']);
    // Saved index 2 was clamped to the surviving tail.
    expect(revived.index).toBe(1);
  });

  it('should start clean (not restored) when storage is corrupted or versioned wrong', () => {
    storage.setItem(QUEUE_STORAGE_KEY, '{not valid json');
    const revived = new PlaybackQueue(storage);
    expect(revived.restore([]).restored).toBe(false);
    expect(revived.isEmpty).toBe(true);

    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ version: 999, items: [track(1)], index: 0 }));
    const revived2 = new PlaybackQueue(storage);
    expect(revived2.restore([track(1)]).restored).toBe(false);
    expect(revived2.isEmpty).toBe(true);
  });

  it('should strip non-serializable fields (File blobs) from local uploads before saving', () => {
    const local = {
      id: 'local-123',
      title: 'My Upload',
      artist: 'Local File',
      file: { fake: 'File blob must not survive JSON' },
    };
    const snap = snapshotTrack(local);
    expect(snap.file).toBeUndefined();
    queue.add(local);
    const parsed = JSON.parse(storage.getItem(QUEUE_STORAGE_KEY));
    expect(parsed.items[0].file).toBeUndefined();
    expect(parsed.items[0].id).toBe('local-123');
  });
});

describe('PlaybackQueue no-autoplay-on-restore', () => {
  it('should never start playback on restore: no play method, no autoplay flag', () => {
    queue.add(track(1));
    queue.add(track(2));
    const revived = new PlaybackQueue(storage);
    revived.restore([track(1), track(2)]);
    // The queue is data + persistence only; starting audio is App.svelte's job
    // after a user gesture (browsers block autoplay regardless).
    expect(typeof revived.play).toBe('undefined');
    expect(typeof revived.autoPlay).toBe('undefined');
    expect(revived.current().id).toBe('1');
  });

  it('should return only restoration metadata from restore — no audio side-channel', () => {
    queue.add(track(1));
    const revived = new PlaybackQueue(storage);
    const result = revived.restore([track(1)]);
    expect(Object.keys(result).sort()).toEqual(['dropped', 'restored']);
    expect(revived.items).toEqual(queue.items);
    expect(revived.index).toBe(queue.index);
  });
});

describe('PlaybackQueue storage failure resilience', () => {
  it('should keep working in memory when setItem throws (quota exceeded), and save again when storage recovers', () => {
    queue.add(track(1));
    const rawBefore = storage.getItem(QUEUE_STORAGE_KEY);
    expect(rawBefore).not.toBeNull();

    // Simulate quota exhaustion: every write now throws.
    const workingSetItem = storage.setItem;
    storage.setItem = () => { throw new Error('QuotaExceededError'); };

    // save() must not throw — it reports failure instead.
    expect(queue.save()).toBe(false);

    // Mutations still update in-memory state (and report save failure, not crash).
    expect(queue.add(track(2))).toBe(true);
    expect(queue.items.map((t) => t.id)).toEqual(['1', '2']);
    expect(queue.move(0, 1)).toBe(true);
    expect(queue.items.map((t) => t.id)).toEqual(['2', '1']);
    expect(queue.removeAt(1).id).toBe('1');
    expect(queue.length).toBe(1);

    // Storage recovers: a later save succeeds and the state round-trips.
    storage.setItem = workingSetItem;
    expect(queue.save()).toBe(true);
    const revived = new PlaybackQueue(storage);
    const result = revived.restore([track(1), track(2)]);
    expect(result.restored).toBe(true);
    expect(revived.items.map((t) => t.id)).toEqual(['2']);
  });

  it('should restore cleanly (no throw) when getItem itself throws', () => {
    storage.getItem = () => { throw new Error('storage locked'); };
    const revived = new PlaybackQueue(storage);
    expect(() => revived.restore([track(1)])).not.toThrow();
    expect(revived.restore([track(1)]).restored).toBe(false);
    expect(revived.isEmpty).toBe(true);
  });
});

describe('PlaybackQueue move() clamping and pointer tracking', () => {
  it('should clamp out-of-range indices instead of corrupting the queue', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    expect(queue.move(0, 99)).toBe(true); // clamped to the tail
    expect(queue.items.map((t) => t.id)).toEqual(['2', '3', '1']);
    expect(queue.move(2, -50)).toBe(true); // clamped to the head
    expect(queue.items.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('should track the pointer when the moved track crosses it', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    queue.setIndex(2); // current = track 3
    queue.move(0, 2); // track 1 moves past the pointer
    expect(queue.items.map((t) => t.id)).toEqual(['2', '3', '1']);
    expect(queue.current().id).toBe('3');
    expect(queue.index).toBe(1);
  });

  it('should round-trip a reordered queue through storage', () => {
    queue.add(track(1));
    queue.add(track(2));
    queue.add(track(3));
    queue.setIndex(2);
    queue.move(2, 0);
    const revived = new PlaybackQueue(storage);
    revived.restore([track(1), track(2), track(3)]);
    expect(revived.items.map((t) => t.id)).toEqual(['3', '1', '2']);
    expect(revived.current().id).toBe('3');
  });
});

describe('PlaybackQueue URL scheme hardening', () => {
  it('should persist http/https URLs (demo tracks)', () => {
    const snap = snapshotTrack({ id: 'x', title: 't', artist: 'a', url: 'https://cdn.example.com/t.mp3' });
    expect(snap.url).toBe('https://cdn.example.com/t.mp3');
  });

  it('should persist relative URLs (resolve against page origin)', () => {
    const snap = snapshotTrack({ id: 'x', title: 't', artist: 'a', url: '/audio/t.mp3' });
    expect(snap.url).toBe('/audio/t.mp3');
  });

  it('should drop non-media schemes: javascript:, file:, blob: (revoked on reload)', () => {
    expect(snapshotTrack({ id: 'a', title: 't', artist: 'a', url: 'javascript:alert(1)' }).url).toBeUndefined();
    expect(snapshotTrack({ id: 'b', title: 't', artist: 'a', url: 'file:///etc/hosts' }).url).toBeUndefined();
    expect(snapshotTrack({ id: 'c', title: 't', artist: 'a', url: 'blob:https://x/y' }).url).toBeUndefined();
  });

  it('should keep the rest of the snapshot even when the URL is dropped', () => {
    const snap = snapshotTrack({ id: 'c', title: 'Title', artist: 'Art', url: 'javascript:alert(1)' });
    expect(snap.id).toBe('c');
    expect(snap.title).toBe('Title');
    expect(snap.url).toBeUndefined();
  });
});
