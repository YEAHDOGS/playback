/**
 * Unit tests for the real AudioDeck class with a mocked Web Audio stack.
 *
 * AudioDeck is the playback heart of the DJ engine (376 lines: pitch, EQ,
 * cueing, scrub, waveform decode, level metering) and previously had zero
 * direct unit tests. This file mocks AudioContext, the HTML Audio element,
 * fetch, and URL so every public method and edge case runs under vitest
 * without a browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AudioDeck from './AudioDeck.js';

// ---------------------------------------------------------------------------
// Mock Web Audio stack
// ---------------------------------------------------------------------------

/** AudioParam mock: setValueAtTime() records the last scheduled value. */
function makeAudioParam() {
  const param = { value: 0 };
  param.setValueAtTime = vi.fn((v) => {
    param.value = v;
  });
  return param;
}

/** Generic audio node mock with gain/frequency/Q params and wiring hooks. */
function makeAudioNode() {
  return {
    type: '',
    gain: makeAudioParam(),
    frequency: makeAudioParam(),
    Q: makeAudioParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** HTML Audio element mock (enough for AudioDeck's constructor + listeners). */
class MockAudio {
  constructor() {
    this.listeners = {};
    this.currentTime = 0;
    this.duration = 0;
    this.playbackRate = 1;
    this.src = '';
    this.crossOrigin = null;
    this.loop = false;
  }
  addEventListener(name, cb) {
    this.listeners[name] = cb;
  }
  removeEventListener() {}
  play() {
    return Promise.resolve();
  }
  pause() {}
  load() {}
}

/** Minimal AudioContext mock tracking created nodes + decodeAudioData calls. */
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
    this.decodeCalls = [];
  }
  createGain() {
    return makeAudioNode();
  }
  createBiquadFilter() {
    return makeAudioNode();
  }
  createAnalyser() {
    const node = makeAudioNode();
    node.frequencyBinCount = 16;
    node.getByteFrequencyData = (arr) => arr.fill(0);
    return node;
  }
  createMediaElementSource() {
    return makeAudioNode();
  }
  decodeAudioData(_buffer, successCb, errorCb) {
    this.decodeCalls.push({ successCb, errorCb });
  }
  resume() {
    this.resumeCalled = true;
    return Promise.resolve();
  }
}

/** Flush pending microtasks/macrotasks (decodeWaveform is not awaited by loadTrack). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.Audio = MockAudio;
  globalThis.window = {};
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  globalThis.URL.revokeObjectURL = vi.fn();
  globalThis.fetch = vi.fn();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeck(id = 'deck1') {
  const states = [];
  const ctx = new MockAudioContext();
  const deck = new AudioDeck(id, ctx, (s) => states.push(s));
  return { deck, ctx, states };
}

function fire(deck, name) {
  deck.audio.listeners[name]();
}

const URL_TRACK = { url: 'https://example.com/track.mp3', bpm: 128 };
const FILE_TRACK = {
  file: { arrayBuffer: async () => new ArrayBuffer(16) },
  bpm: 124,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioDeck construction', () => {
  it('publishes a well-shaped initial state', () => {
    const { deck, states } = makeDeck();
    expect(states.length).toBeGreaterThan(0);
    const s = states[0];
    expect(s).toMatchObject({
      id: 'deck1',
      playing: false,
      loadedTrack: null,
      currentTime: 0,
      duration: 0,
      pitch: 0,
      bpm: 120,
      currentBpm: 120,
      pitchRange: 0.08,
      volume: 1.0,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      cuePoint: 0,
      isDecoding: false,
      waveformPeaks: [],
    });
  });

  it('configures the audio element safely', () => {
    const { deck } = makeDeck();
    expect(deck.audio.crossOrigin).toBe('anonymous');
    expect(deck.audio.loop).toBe(false);
  });

  it('wires the EQ -> gain -> analyser graph in order', () => {
    const { deck } = makeDeck();
    expect(deck.lowFilter.connect).toHaveBeenCalledWith(deck.midFilter);
    expect(deck.midFilter.connect).toHaveBeenCalledWith(deck.highFilter);
    expect(deck.highFilter.connect).toHaveBeenCalledWith(deck.gainNode);
    expect(deck.gainNode.connect).toHaveBeenCalledWith(deck.analyserNode);
    expect(deck.outputNode).toBe(deck.analyserNode);
    expect(deck.analyserNode.fftSize).toBe(32);
  });
});

describe('AudioDeck loadTrack()', () => {
  it('ignores null/undefined tracks without throwing', async () => {
    const { deck } = makeDeck();
    await expect(deck.loadTrack(null)).resolves.toBeUndefined();
    await expect(deck.loadTrack(undefined)).resolves.toBeUndefined();
    expect(deck.loadedTrack).toBeNull();
  });

  it('loads a URL track and resets deck state', async () => {
    const { deck } = makeDeck();
    globalThis.fetch.mockReturnValue(new Promise(() => {})); // decode stays pending
    deck.cuePoint = 42;
    deck.waveformPeaks = [0.1, 0.2];

    await deck.loadTrack(URL_TRACK);

    expect(deck.loadedTrack).toBe(URL_TRACK);
    expect(deck.bpm).toBe(128);
    expect(deck.currentTime).toBe(0);
    expect(deck.cuePoint).toBe(0);
    expect(deck.waveformPeaks).toEqual([]);
    expect(deck.audio.src).toBe(URL_TRACK.url);
  });

  it('defaults BPM to 120 when the track has none', async () => {
    const { deck } = makeDeck();
    globalThis.fetch.mockReturnValue(new Promise(() => {})); // decode stays pending
    await deck.loadTrack({ url: 'https://example.com/no-bpm.mp3' });
    expect(deck.bpm).toBe(120);
  });

  it('loads a local file via object URL', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(FILE_TRACK);
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(FILE_TRACK.file);
    expect(deck.audio.src).toBe('blob:mock-url');
    expect(deck.bpm).toBe(124);
  });

  it('decodes a real waveform from file bytes when decode succeeds', async () => {
    const { deck, ctx } = makeDeck();
    await deck.loadTrack(FILE_TRACK);
    await tick();
    await tick();

    expect(ctx.decodeCalls.length).toBe(1);
    ctx.decodeCalls[0].successCb({
      getChannelData: () => new Float32Array(600).fill(0.5),
    });

    expect(deck.waveformPeaks).toHaveLength(300);
    expect(deck.waveformPeaks.every((p) => p === 0.5)).toBe(true);
    expect(deck.isDecoding).toBe(false);
  });

  it('falls back to synthetic peaks when decoding fails', async () => {
    const { deck, ctx } = makeDeck();
    globalThis.fetch.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(16),
    });
    await deck.loadTrack(URL_TRACK);
    await tick();
    await tick();

    ctx.decodeCalls[0].errorCb(new Error('bad data'));

    expect(deck.waveformPeaks).toHaveLength(300);
    expect(deck.isDecoding).toBe(false);
  });

  it('fetches remote audio bytes for URL tracks', async () => {
    const { deck } = makeDeck();
    globalThis.fetch.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(16),
    });
    await deck.loadTrack(URL_TRACK);
    await tick();
    await tick();

    expect(globalThis.fetch).toHaveBeenCalledWith(URL_TRACK.url);
    expect(deck.isDecoding).toBe(true); // waiting on decodeAudioData callback
  });

  it('falls back to synthetic peaks when fetch fails', async () => {
    const { deck } = makeDeck();
    globalThis.fetch.mockRejectedValue(new Error('network down'));
    await deck.loadTrack(URL_TRACK);
    await tick();
    await tick();

    expect(deck.waveformPeaks).toHaveLength(300);
    expect(deck.isDecoding).toBe(false);
  });
});

describe('AudioDeck waveform decode race', () => {
  beforeEach(() => {
    globalThis.fetch.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(16),
    });
  });

  it('ignores a stale success decode from the previous track', async () => {
    const { deck, ctx } = makeDeck();
    await deck.loadTrack(FILE_TRACK); // decode token 1
    await tick();
    await tick();
    await deck.loadTrack(URL_TRACK); // decode token 2
    await tick();
    await tick();

    expect(ctx.decodeCalls.length).toBe(2);

    // The first decode resolves AFTER the second track was loaded.
    ctx.decodeCalls[0].successCb({
      getChannelData: () => new Float32Array(600).fill(0.5),
    });

    // Stale peaks must not be applied; deck is still waiting on the new track.
    expect(deck.waveformPeaks).toEqual([]);
    expect(deck.isDecoding).toBe(true);
    expect(deck.loadedTrack).toBe(URL_TRACK);

    // The current track's decode still applies.
    ctx.decodeCalls[1].successCb({
      getChannelData: () => new Float32Array(600).fill(0.25),
    });

    expect(deck.waveformPeaks).toHaveLength(300);
    expect(deck.waveformPeaks.every((p) => p === 0.25)).toBe(true);
    expect(deck.isDecoding).toBe(false);
  });

  it('ignores a stale error decode from the previous track', async () => {
    const { deck, ctx } = makeDeck();
    await deck.loadTrack(FILE_TRACK); // decode token 1
    await tick();
    await tick();
    await deck.loadTrack(URL_TRACK); // decode token 2
    await tick();
    await tick();

    // The first decode errors out after the swap: no synthetic fallback for
    // the old track, decode state still belongs to the new track.
    ctx.decodeCalls[0].errorCb(new Error('stale decode'));
    expect(deck.waveformPeaks).toEqual([]);
    expect(deck.isDecoding).toBe(true);

    // The new track's own error still falls back to synthetic peaks.
    ctx.decodeCalls[1].errorCb(new Error('bad data'));
    expect(deck.waveformPeaks).toHaveLength(300);
    expect(deck.isDecoding).toBe(false);
  });
});

describe('AudioDeck transport', () => {
  it('play() is a safe no-op with no track loaded', async () => {
    const { deck } = makeDeck();
    const playSpy = vi.spyOn(deck.audio, 'play');
    expect(() => deck.play()).not.toThrow();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('play() starts the audio element and resumes a suspended context', async () => {
    const { deck, ctx } = makeDeck();
    ctx.state = 'suspended';
    await deck.loadTrack(URL_TRACK);
    const playSpy = vi.spyOn(deck.audio, 'play');
    deck.play();

    expect(ctx.resumeCalled).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('togglePlay() flips between play and pause', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(URL_TRACK);
    const playSpy = vi.spyOn(deck.audio, 'play');
    const pauseSpy = vi.spyOn(deck.audio, 'pause');

    fire(deck, 'play');
    deck.togglePlay();
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    fire(deck, 'pause');
    deck.togglePlay();
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('event listeners keep playing state in sync', async () => {
    const { deck } = makeDeck();
    fire(deck, 'play');
    expect(deck.playing).toBe(true);
    fire(deck, 'pause');
    expect(deck.playing).toBe(false);
    fire(deck, 'play');
    fire(deck, 'ended');
    expect(deck.playing).toBe(false);
    expect(deck.audio.currentTime).toBe(0); // rewinds on end
  });

  it('timeupdate and durationchange listeners update state', () => {
    const { deck, states } = makeDeck();
    deck.audio.currentTime = 12.5;
    fire(deck, 'timeupdate');
    expect(deck.currentTime).toBe(12.5);

    deck.audio.duration = 240;
    fire(deck, 'durationchange');
    expect(deck.duration).toBe(240);
    expect(states[states.length - 1].duration).toBe(240);
  });
});

describe('AudioDeck scrub()', () => {
  it('does nothing when duration is unknown', () => {
    const { deck } = makeDeck();
    deck.duration = 0;
    expect(() => deck.scrub(0.5)).not.toThrow();
    expect(deck.audio.currentTime).toBe(0);
  });

  it('seeks to percent * duration', () => {
    const { deck } = makeDeck();
    deck.duration = 120;
    deck.scrub(0.25);
    expect(deck.audio.currentTime).toBe(30);
    expect(deck.currentTime).toBe(30);
  });

  it('clamps out-of-range input to the track bounds', () => {
    const { deck } = makeDeck();
    deck.duration = 120;
    deck.scrub(1.5);
    expect(deck.audio.currentTime).toBe(120);
    deck.scrub(-0.5);
    expect(deck.audio.currentTime).toBe(0);
  });
});

describe('AudioDeck pitch', () => {
  it('clamps pitch to +/-16% and applies playbackRate', () => {
    const { deck } = makeDeck();
    deck.setPitch(0.5);
    expect(deck.pitch).toBeCloseTo(0.16, 10);
    expect(deck.audio.playbackRate).toBeCloseTo(1.16, 10);
    deck.setPitch(-0.5);
    expect(deck.pitch).toBeCloseTo(-0.16, 10);
    expect(deck.audio.playbackRate).toBeCloseTo(0.84, 10);
  });

  it('updates current BPM from pitch', () => {
    const { deck } = makeDeck();
    deck.bpm = 128;
    deck.setPitch(0.08);
    expect(deck.currentBpm).toBe(138.2); // round(128 * 1.08, 1dp)
  });

  it('setPitchRange() stores the new range', () => {
    const { deck } = makeDeck();
    deck.setPitchRange(0.16);
    expect(deck.pitchRange).toBe(0.16);
  });
});

describe('AudioDeck syncTo()', () => {
  it('computes the pitch needed to match a target BPM', () => {
    const { deck } = makeDeck();
    deck.bpm = 120;
    deck.syncTo(128);
    expect(deck.pitch).toBeCloseTo(128 / 120 - 1, 10);
  });

  it('is a no-op when the deck BPM is zero', () => {
    const { deck } = makeDeck();
    deck.bpm = 0;
    expect(() => deck.syncTo(128)).not.toThrow();
    expect(deck.pitch).toBe(0);
  });
});

describe('AudioDeck EQ and volume', () => {
  it('routes gains to the correct filter and clamps to +/-12 dB', () => {
    const { deck } = makeDeck();
    deck.setEQ('low', 6);
    expect(deck.eqLow).toBe(6);
    expect(deck.lowFilter.gain.value).toBe(6);
    deck.setEQ('mid', -15);
    expect(deck.eqMid).toBe(-12);
    expect(deck.midFilter.gain.value).toBe(-12);
    deck.setEQ('high', 15);
    expect(deck.eqHigh).toBe(12);
    expect(deck.highFilter.gain.value).toBe(12);
  });

  it('ignores unknown EQ bands without throwing', () => {
    const { deck } = makeDeck();
    expect(() => deck.setEQ('presence', 5)).not.toThrow();
    expect(deck.lowFilter.gain.value).toBe(0);
    expect(deck.midFilter.gain.value).toBe(0);
    expect(deck.highFilter.gain.value).toBe(0);
  });

  it('clamps volume to [0, 1] and drives the deck gain node', () => {
    const { deck } = makeDeck();
    deck.setVolume(1.5);
    expect(deck.volume).toBe(1.0);
    deck.setVolume(-0.2);
    expect(deck.volume).toBe(0.0);
    deck.setVolume(0.4);
    expect(deck.volume).toBe(0.4);
    expect(deck.gainNode.gain.value).toBe(0.4);
  });
});

describe('AudioDeck cue points', () => {
  it('setCue() stores the current position', () => {
    const { deck } = makeDeck();
    deck.audio.currentTime = 33.3;
    deck.setCue();
    expect(deck.cuePoint).toBe(33.3);
  });

  it('playCue() is a safe no-op with no track loaded', async () => {
    const { deck } = makeDeck();
    const playSpy = vi.spyOn(deck.audio, 'play');
    expect(() => deck.playCue()).not.toThrow();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('playCue() jumps to the cue point and plays', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(URL_TRACK);
    deck.audio.currentTime = 45;
    deck.setCue();
    deck.audio.currentTime = 10;
    const playSpy = vi.spyOn(deck.audio, 'play');
    deck.playCue();
    expect(deck.audio.currentTime).toBe(45);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AudioDeck getVolumeLevel()', () => {
  it('returns 0 when not playing', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(URL_TRACK);
    expect(deck.getVolumeLevel()).toBe(0);
  });

  it('returns a normalized average of the frequency bins while playing', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(URL_TRACK);
    deck.analyserNode.getByteFrequencyData = (arr) => arr.fill(128);
    fire(deck, 'play');
    expect(deck.getVolumeLevel()).toBeCloseTo(128 / 255, 10);
  });
});

describe('AudioDeck object URL lifecycle', () => {
  it('tracks the blob URL created for a file track', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(FILE_TRACK);
    expect(deck.objectUrl).toBe('blob:mock-url');
  });

  it('revokes the old blob URL when a new track loads', async () => {
    const { deck } = makeDeck();
    globalThis.fetch.mockReturnValue(new Promise(() => {})); // keep decode pending

    await deck.loadTrack(FILE_TRACK);
    expect(deck.objectUrl).toBe('blob:mock-url');

    // Loading a stream-URL track: the old blob URL must be released.
    await deck.loadTrack(URL_TRACK);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(deck.objectUrl).toBeNull();

    // And no revoke happened again before that load (clean accounting).
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the old blob URL when another file track loads', async () => {
    const { deck } = makeDeck();
    const secondFile = { file: { arrayBuffer: async () => new ArrayBuffer(8) }, bpm: 130 };

    await deck.loadTrack(FILE_TRACK);
    await deck.loadTrack(secondFile);

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(deck.objectUrl).toBe('blob:mock-url'); // fresh URL for the new track
    expect(deck.audio.src).toBe('blob:mock-url');
  });

  it('does not revoke anything when no file was ever loaded', async () => {
    const { deck } = makeDeck();
    globalThis.fetch.mockReturnValue(new Promise(() => {}));
    await deck.loadTrack(URL_TRACK);
    expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(() => deck.revokeObjectUrl()).not.toThrow();
  });

  it('destroy() revokes the tracked blob URL and clears the reference', async () => {
    const { deck } = makeDeck();
    await deck.loadTrack(FILE_TRACK);

    deck.destroy();

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(deck.objectUrl).toBeNull();
    // Second destroy stays safe (no double revoke).
    expect(() => deck.destroy()).not.toThrow();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('AudioDeck destroy()', () => {
  it('pauses, clears the source, and disconnects the graph without throwing', () => {
    const { deck } = makeDeck();
    deck.audio.src = 'blob:mock-url';
    const pauseSpy = vi.spyOn(deck.audio, 'pause');

    expect(() => deck.destroy()).not.toThrow();

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(deck.audio.src).toBe('');
    expect(deck.lowFilter.disconnect).toHaveBeenCalled();
    expect(deck.analyserNode.disconnect).toHaveBeenCalled();

    // Second destroy stays safe too
    expect(() => deck.destroy()).not.toThrow();
  });
});

describe('AudioDeck load error surfacing', () => {
  it('starts with loadError null', () => {
    const { deck, states } = makeDeck();
    expect(deck.loadError).toBeNull();
    expect(states[0].loadError).toBeNull();
  });

  it('publishes the media error code when the audio element fails', () => {
    const { deck, states } = makeDeck();
    // MEDIA_ERR_NETWORK
    deck.audio.error = { code: 2 };
    fire(deck, 'error');

    expect(deck.loadError).toEqual({ code: 2 });
    expect(deck.playing).toBe(false);
    expect(states.at(-1).loadError).toEqual({ code: 2 });
  });

  it('still surfaces an error when audio.error is absent', () => {
    const { deck } = makeDeck();
    deck.audio.error = undefined;
    expect(() => fire(deck, 'error')).not.toThrow();
    expect(deck.loadError).toEqual({ code: 0 });
  });

  it('clears loadError when a new track is loaded', async () => {
    const { deck, states } = makeDeck();
    deck.audio.error = { code: 3 }; // MEDIA_ERR_DECODE
    fire(deck, 'error');
    expect(deck.loadError).toEqual({ code: 3 });

    await deck.loadTrack(URL_TRACK);
    expect(deck.loadError).toBeNull();
    expect(states.at(-1).loadError).toBeNull();
  });
});

describe('AudioDeck post-destroy silence', () => {
  it('publishes nothing when a media error arrives after destroy()', () => {
    const { deck, states } = makeDeck();
    const before = states.length;

    deck.destroy();
    deck.audio.error = { code: 2 }; // MEDIA_ERR_NETWORK, arriving late
    fire(deck, 'error');

    expect(states.length).toBe(before);
  });

  it('publishes nothing when an in-flight waveform decode finishes after destroy()', async () => {
    const { deck, ctx, states } = makeDeck();
    let resolveFetch;
    globalThis.fetch.mockReturnValue(new Promise((res) => { resolveFetch = res; }));

    deck.loadTrack(URL_TRACK); // decode starts, fetch hangs
    deck.destroy();
    const before = states.length;

    resolveFetch({ arrayBuffer: async () => new ArrayBuffer(8) });
    await tick();
    const decodeCall = ctx.decodeCalls.at(-1);
    decodeCall.successCb({ getChannelData: () => new Float32Array(16) });
    await tick();

    expect(deck.waveformPeaks).toEqual([]);
    expect(states.length).toBe(before);
  });

  it('stays silent across a second destroy()', () => {
    const { deck, states } = makeDeck();
    deck.destroy();
    const before = states.length;

    deck.destroy();
    fire(deck, 'ended');

    expect(states.length).toBe(before);
  });
});
