import { describe, it, expect, beforeAll } from 'vitest';
import AudioDeck from './AudioDeck.js';

// Loudness-guard regression tests: a hot master must be pulled down toward
// the reference level, quiet tracks must pass through untouched, and garbage
// input must never poison the gain node. Mocked Web Audio only — no browser.

// --- Test doubles -----------------------------------------------------------

class MockAudioElement {
  constructor() {
    this.listeners = {};
    this.src = '';
    this.currentTime = 0;
    this.duration = 0;
  }
  addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
  removeEventListener() {}
  emit(type) { (this.listeners[type] || []).forEach((cb) => cb()); }
  load() {}
  pause() {}
  play() { return Promise.resolve(); }
}

function mockGain() {
  return { gain: { value: 1.0 }, connect() {}, disconnect() {} };
}

function mockAudioContext() {
  const biquad = () => ({
    type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 },
    connect() {}, disconnect() {},
  });
  return {
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    createBiquadFilter: biquad,
    createGain: mockGain,
    createAnalyser: () => ({
      fftSize: 32, frequencyBinCount: 8,
      connect() {}, disconnect() {},
      getByteFrequencyData: (arr) => arr.fill(0),
    }),
  };
}

function makeDeck(hooks) {
  return new AudioDeck('deck1', mockAudioContext(), () => {}, hooks);
}

const avg = (n, v) => Array.from({ length: n }, () => v);

beforeAll(() => {
  globalThis.Audio = MockAudioElement;
  // decodeWaveform falls back to synthetic peaks when fetch fails.
  globalThis.fetch = async () => { throw new Error('network disabled in tests'); };
});

// --- Pure loudness math ------------------------------------------------------

describe('AudioDeck.calculateTrackGain (peaks-based, real implementation)', () => {
  it('should pass garbage input through as 1.0 (never poison the gain node)', () => {
    [null, undefined, 'loud', 42, [], [NaN, NaN], [Infinity, -Infinity]].forEach((bad) => {
      const g = AudioDeck.calculateTrackGain(bad);
      expect(Number.isFinite(g)).toBe(true);
      expect(g).toBe(1.0);
    });
  });

  it('should leave quiet and reference-level tracks untouched (x1.0)', () => {
    expect(AudioDeck.calculateTrackGain(avg(300, 0.2))).toBe(1.0);
    expect(AudioDeck.calculateTrackGain(avg(300, 0.45))).toBe(1.0);
    expect(AudioDeck.calculateTrackGain(avg(300, 0.0))).toBe(1.0);
  });

  it('should attenuate a hot master: 0.9 avg peaks -> 0.5', () => {
    const g = AudioDeck.calculateTrackGain(avg(300, 0.9));
    expect(g).toBeCloseTo(0.5, 5);
  });

  it('should attenuate a brickwalled track: 1.0 avg peaks -> 0.45', () => {
    const g = AudioDeck.calculateTrackGain(avg(300, 1.0));
    expect(g).toBeCloseTo(0.45, 5);
  });

  it('should treat above-full-scale peaks as brickwalled (clipped to 1.0 -> 0.45)', () => {
    // Real decoded peaks are 0..1 by construction; synthetic abuse of the API
    // gets clipped, never pushed below the brickwall worst case of 0.45.
    const g = AudioDeck.calculateTrackGain(avg(300, 5.0));
    expect(g).toBeCloseTo(0.45, 5);
  });

  it('should clip out-of-range peak values and stay finite in [0.25, 1]', () => {
    const g = AudioDeck.calculateTrackGain([1.5, -2, 0.9, NaN]);
    expect(Number.isFinite(g)).toBe(true);
    expect(g).toBeGreaterThanOrEqual(0.25);
    expect(g).toBeLessThanOrEqual(1.0);
  });
});

describe('AudioDeck.calculateTrackGainFromDb (metadata loudness, real implementation)', () => {
  it('should pass non-finite metadata through as 1.0', () => {
    [NaN, undefined, null, Infinity, 'loud'].forEach((bad) => {
      expect(AudioDeck.calculateTrackGainFromDb(bad)).toBe(1.0);
    });
  });

  it('should leave a track at the reference level (-14 dB) untouched', () => {
    expect(AudioDeck.calculateTrackGainFromDb(-14)).toBeCloseTo(1.0, 5);
  });

  it('should attenuate a hot master (-4 dB): 10^(-10/20) ~= 0.316', () => {
    expect(AudioDeck.calculateTrackGainFromDb(-4)).toBeCloseTo(0.316227, 4);
  });

  it('should never boost a quiet track (-24 dB -> 1.0, not >1)', () => {
    expect(AudioDeck.calculateTrackGainFromDb(-24)).toBe(1.0);
  });

  it('should clamp extreme hotness (0 dB -> 0.25 floor)', () => {
    expect(AudioDeck.calculateTrackGainFromDb(0)).toBe(0.25);
  });
});

// --- Gain application --------------------------------------------------------

describe('AudioDeck loudness-guard gain application (mocked graph)', () => {
  it('should multiply deck volume by trackGain in the graph', () => {
    const deck = makeDeck();
    deck.setVolume(0.8);
    expect(deck.gainNode.gain.value).toBeCloseTo(0.8, 10);
    deck.applyLoudnessFromPeaks(avg(300, 0.9)); // trackGain -> 0.5
    expect(deck.trackGain).toBeCloseTo(0.5, 5);
    expect(deck.gainNode.gain.value).toBeCloseTo(0.8 * 0.5, 10);
    deck.setVolume(1.0);
    expect(deck.gainNode.gain.value).toBeCloseTo(0.5, 10);
  });

  it('should be a no-op (never throw) when the graph is not built yet', () => {
    const deck = makeDeck();
    deck.gainNode = null;
    expect(() => deck.applyGain()).not.toThrow();
    expect(() => deck.applyLoudnessFromPeaks(avg(300, 0.9))).not.toThrow();
    expect(deck.trackGain).toBeCloseTo(0.5, 5);
  });

  it('should seed trackGain from track.loudnessDb on loadTrack()', async () => {
    const deck = makeDeck();
    await deck.loadTrack({ url: 'https://example.com/hot.mp3', loudnessDb: -4 });
    expect(deck.trackGain).toBeCloseTo(0.316227, 4);
    expect(deck.gainNode.gain.value).toBeCloseTo(0.316227, 4); // volume 1.0 * trackGain
  });

  it('should reset trackGain to 1.0 when the next track has no loudness info', async () => {
    const deck = makeDeck();
    await deck.loadTrack({ url: 'https://example.com/hot.mp3', loudnessDb: -4 });
    expect(deck.trackGain).toBeLessThan(1.0);
    await deck.loadTrack({ url: 'https://example.com/quiet.mp3' });
    expect(deck.trackGain).toBe(1.0);
    expect(deck.gainNode.gain.value).toBeCloseTo(deck.volume, 10);
  });
});

// --- Resume seek: loadTrack(track, { startAt }) --------------------------------

describe('AudioDeck resume seek (loadTrack startAt)', () => {
  it('should apply startAt on loadedmetadata once the duration is known', async () => {
    const deck = makeDeck();
    await deck.loadTrack({ url: 'https://example.com/x.mp3' }, { startAt: 30 });
    expect(deck.audio.currentTime).toBe(0); // not applied before metadata
    deck.audio.duration = 100;
    deck.audio.emit('loadedmetadata');
    expect(deck.audio.currentTime).toBe(30);
    expect(deck.pendingSeek).toBe(0); // consumed exactly once
  });

  it('should clamp a stale startAt inside the track duration (never skip on resume)', async () => {
    const deck = makeDeck();
    await deck.loadTrack({ url: 'https://example.com/x.mp3' }, { startAt: 200 });
    deck.audio.duration = 100;
    deck.audio.emit('loadedmetadata');
    // parks just before the end instead of past it (past-end would fire
    // 'ended' immediately and auto-advance would skip the resumed track)
    expect(deck.audio.currentTime).toBeLessThan(100);
    expect(deck.audio.currentTime).toBeCloseTo(99.75, 5);
  });

  it('should collapse garbage startAt (NaN/negative/Infinity) to 0', async () => {
    for (const bad of [NaN, -5, Infinity, undefined, '30']) {
      const deck = makeDeck();
      await deck.loadTrack({ url: 'https://example.com/x.mp3' }, { startAt: bad });
      deck.audio.duration = 100;
      deck.audio.emit('loadedmetadata');
      expect(deck.audio.currentTime).toBe(0);
    }
  });

  it('should stay at 0 when no startAt is given', async () => {
    const deck = makeDeck();
    await deck.loadTrack({ url: 'https://example.com/x.mp3' });
    deck.audio.duration = 100;
    deck.audio.emit('loadedmetadata');
    expect(deck.audio.currentTime).toBe(0);
  });
});

// --- onTrackEnd hook ------------------------------------------------------------

describe('AudioDeck onTrackEnd hook', () => {
  it('should fire onTrackEnd with the deck id when the track plays to completion', () => {
    const seen = [];
    const deck = makeDeck({ onTrackEnd: (id) => seen.push(id) });
    deck.audio.emit('ended');
    expect(seen).toEqual(['deck1']);
  });

  it('should be a silent no-op when no hook is wired', () => {
    const deck = makeDeck();
    expect(() => deck.audio.emit('ended')).not.toThrow();
    expect(deck.playing).toBe(false);
  });

  it('should survive a throwing hook without breaking deck state', () => {
    const deck = makeDeck({ onTrackEnd: () => { throw new Error('boom'); } });
    expect(() => deck.audio.emit('ended')).not.toThrow();
    expect(deck.playing).toBe(false);
  });
});
