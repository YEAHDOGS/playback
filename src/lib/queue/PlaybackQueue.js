// PlaybackQueue — persistent playback queue that survives reloads.
//
// The queue is pure data + localStorage persistence. It NEVER touches audio:
// restore() rehydrates the track list and saved position, but playback stays
// paused — browsers block autoplay without a user gesture anyway, so the
// natural boot behavior is "resume paused at the saved track/position".
//
// Stored shape (JSON, keyed by QUEUE_STORAGE_KEY):
//   { version: 1, items: [trackSnapshot, ...], index: 0, position: 0 }
// Track snapshots keep only serializable metadata — full track objects carry
// File/Blob refs (local uploads) that can't survive a reload, so those are
// stripped on save and re-resolved against the live catalog on restore.
// Any snapshot whose id is no longer in the catalog is stale and gets
// dropped, with the drop count reported back to the caller (UI toast,
// console note — caller's choice).

export const QUEUE_STORAGE_KEY = 'playback.queue.v1';
export const QUEUE_SCHEMA_VERSION = 1;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** In-memory fallback so the queue works (and is testable) where localStorage is absent. */
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function defaultStorage() {
  try {
    if (typeof globalThis.localStorage !== 'undefined') return globalThis.localStorage;
  } catch {
    /* localStorage can throw on access in locked-down iframes */
  }
  return createMemoryStorage();
}

/** Strip a full track object down to what can survive JSON + reload. */
export function snapshotTrack(track) {
  if (!track || track.id == null) return null;
  const snap = {
    id: String(track.id),
    title: track.title ?? 'Untitled',
    artist: track.artist ?? 'Unknown',
  };
  // Streamable demo tracks keep their URL; local File/Blob refs can't be serialized.
  if (typeof track.url === 'string' && track.url) snap.url = track.url;
  if (track.bpm != null) snap.bpm = Number(track.bpm);
  return snap;
}

export class PlaybackQueue {
  /**
   * @param {Storage} [storage] — defaults to globalThis.localStorage,
   *   falling back to an in-memory store (used by tests).
   */
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.items = [];
    this.index = -1;   // current-track pointer; -1 when the queue is empty
    this.position = 0; // saved seek position (seconds) for the current track
  }

  get length() { return this.items.length; }
  get isEmpty() { return this.items.length === 0; }

  /** The currently-pointed-to track, or null. */
  current() { return this.index >= 0 ? (this.items[this.index] ?? null) : null; }

  /** Append a track. Duplicates by id are skipped — a queue shouldn't repeat by accident. */
  add(track) {
    const snap = snapshotTrack(track);
    if (!snap) return false;
    if (this.items.some((t) => t.id === snap.id)) return false;
    this.items.push(snap);
    if (this.index === -1) this.index = 0;
    this.save();
    return true;
  }

  /** Insert a track right after the current one (play-next). */
  addNext(track) {
    const snap = snapshotTrack(track);
    if (!snap) return false;
    if (this.items.some((t) => t.id === snap.id)) return false;
    const at = this.index === -1 ? 0 : this.index + 1;
    this.items.splice(at, 0, snap);
    if (this.index === -1) this.index = 0;
    this.save();
    return true;
  }

  /** Remove the track at position i. Returns the removed snapshot or null. */
  removeAt(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return null;
    const [removed] = this.items.splice(i, 1);
    if (this.items.length === 0) {
      this.index = -1;
      this.position = 0;
    } else if (i < this.index) {
      this.index -= 1;
    } else if (i === this.index) {
      this.index = clamp(this.index, 0, this.items.length - 1);
      this.position = 0;
    }
    this.save();
    return removed;
  }

  /** Move the track at `from` to position `to`. Indices are clamped. */
  move(from, to) {
    if (this.items.length < 2) return false;
    const f = clamp(Math.trunc(from), 0, this.items.length - 1);
    const t = clamp(Math.trunc(to), 0, this.items.length - 1);
    if (f === t) return false;
    const [item] = this.items.splice(f, 1);
    this.items.splice(t, 0, item);
    // Keep the current-track pointer on the same track it was pointing at.
    if (this.index === f) {
      this.index = t;
    } else if (f < this.index && this.index <= t) {
      this.index -= 1;
    } else if (t <= this.index && this.index < f) {
      this.index += 1;
    }
    this.save();
    return true;
  }

  /** Empty the queue. */
  clear() {
    this.items = [];
    this.index = -1;
    this.position = 0;
    this.save();
  }

  /** Point at track i (clamped) and reset the saved position. */
  setIndex(i) {
    if (this.items.length === 0) return false;
    this.index = clamp(Math.trunc(i), 0, this.items.length - 1);
    this.position = 0;
    this.save();
    return true;
  }

  /** Advance to the next track. Returns the track or null at the end. */
  next() {
    if (this.index + 1 >= this.items.length) return null;
    this.index += 1;
    this.position = 0;
    this.save();
    return this.current();
  }

  /** Step back to the previous track. Returns the track or null at the start. */
  prev() {
    if (this.index - 1 < 0) return null;
    this.index -= 1;
    this.position = 0;
    this.save();
    return this.current();
  }

  /** Remember the seek position (seconds) for the current track. */
  setPosition(seconds) {
    if (!Number.isFinite(seconds)) return false;
    this.position = Math.max(0, seconds);
    this.save();
    return true;
  }

  /** Persist the queue as JSON. */
  save() {
    try {
      this.storage.setItem(
        QUEUE_STORAGE_KEY,
        JSON.stringify({
          version: QUEUE_SCHEMA_VERSION,
          items: this.items,
          index: this.index,
          position: this.position,
        })
      );
      return true;
    } catch {
      return false; // quota exceeded / storage locked — queue still works in memory
    }
  }

  /**
   * Rehydrate from storage WITHOUT starting playback — callers must wait for
   * a user gesture (browsers block autoplay).
   *
   * @param {Array} catalog — live track objects; anything in storage whose id
   *   isn't in the catalog is stale and gets dropped.
   * @returns {{ restored: boolean, dropped: number }} — `dropped` counts the
   *   stale entries removed, so the UI can note what vanished.
   */
  restore(catalog = []) {
    let raw = null;
    try {
      raw = this.storage.getItem(QUEUE_STORAGE_KEY);
    } catch {
      raw = null;
    }
    let saved = null;
    try {
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null; // corrupted JSON — start clean
    }
    if (!saved || saved.version !== QUEUE_SCHEMA_VERSION || !Array.isArray(saved.items)) {
      this.items = [];
      this.index = -1;
      this.position = 0;
      return { restored: false, dropped: 0 };
    }

    const catalogIds = new Set(catalog.map((t) => String(t.id)));
    const fresh = [];
    let dropped = 0;
    for (const item of saved.items) {
      const snap = snapshotTrack(item);
      if (snap && catalogIds.has(snap.id)) {
        fresh.push(snap);
      } else {
        dropped += 1;
      }
    }
    this.items = fresh;
    if (fresh.length === 0) {
      this.index = -1;
      this.position = 0;
    } else {
      this.index = Number.isInteger(saved.index)
        ? clamp(saved.index, 0, fresh.length - 1)
        : 0;
      this.position = Number.isFinite(saved.position) ? Math.max(0, saved.position) : 0;
    }
    // NOTE: deliberately no play(), no autoplay flag, no audio touch.
    return { restored: true, dropped };
  }
}
