/**
 * Unit tests for the real DjEngine class with a mocked Web Audio stack.
 *
 * The pre-existing DjEngine.test.js only re-verifies the crossfader math with a
 * local copy of the formula — it never instantiates DjEngine, so regressions in
 * init(), clamping, wiring, syncDecks() or destroy() would go unnoticed. This
 * file mocks AudioContext, window, and the HTML Audio element so the engine's
 * actual logic runs under test without a browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DjEngine from './DjEngine.js';

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

/** Minimal AudioContext mock tracking created nodes. */
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
    this.createdGains = [];
  }
  createGain() {
    const node = makeAudioNode();
    this.createdGains.push(node);
    return node;
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
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closeCalled = true;
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.Audio = MockAudio;
  globalThis.window = { AudioContext: MockAudioContext };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DjEngine lifecycle', () => {
  it('initializes once and reports engine state', () => {
    const states = [];
    const engine = new DjEngine((s) => states.push(s));

    expect(engine.initialized).toBe(false);
    engine.init();

    expect(engine.initialized).toBe(true);
    expect(engine.deck1).toBeDefined();
    expect(engine.deck2).toBeDefined();
    expect(engine.deck1.id).toBe('deck1');
    expect(engine.deck2.id).toBe('deck2');

    const last = states[states.length - 1];
    expect(last.initialized).toBe(true);
    expect(last.masterVolume).toBe(0.8);
    expect(last.crossfader).toBe(0.0);
    expect(last.deck1.id).toBe('deck1');
    expect(last.deck2.id).toBe('deck2');
  });

  it('ignores a second init() call (idempotent)', () => {
    const engine = new DjEngine();
    engine.init();
    const context = engine.audioContext;
    engine.init();
    expect(engine.audioContext).toBe(context); // no new context created
  });

  it('wires crossfader gains and master gain to the destination', () => {
    const engine = new DjEngine();
    engine.init();

    expect(engine.crossfaderGainL.connect).toHaveBeenCalledWith(engine.masterGain);
    expect(engine.crossfaderGainR.connect).toHaveBeenCalledWith(engine.masterGain);
    expect(engine.masterGain.connect).toHaveBeenCalledWith(engine.audioContext.destination);
  });

  it('destroy() closes the context without throwing, even uninitialized', () => {
    const engine = new DjEngine();
    expect(() => engine.destroy()).not.toThrow(); // never initialized

    engine.init();
    expect(() => engine.destroy()).not.toThrow();
    expect(engine.audioContext.closeCalled).toBe(true);

    // Second destroy stays safe too
    expect(() => engine.destroy()).not.toThrow();
  });
});

describe('DjEngine master volume', () => {
  it('clamps out-of-range values to [0, 1]', () => {
    const engine = new DjEngine();
    engine.init();

    engine.setMasterVolume(1.5);
    expect(engine.masterVolume).toBe(1.0);
    engine.setMasterVolume(-0.5);
    expect(engine.masterVolume).toBe(0.0);
    engine.setMasterVolume(0.6);
    expect(engine.masterVolume).toBe(0.6);
  });

  it('applies volume to the master gain node', () => {
    const engine = new DjEngine();
    engine.init();

    engine.setMasterVolume(0.5);
    expect(engine.masterGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    expect(engine.masterGain.gain.value).toBe(0.5);
  });

  it('is safe to call before init()', () => {
    const engine = new DjEngine();
    expect(() => engine.setMasterVolume(0.5)).not.toThrow();
    expect(engine.masterVolume).toBe(0.5);
  });
});

describe('DjEngine crossfader', () => {
  it('clamps out-of-range values to [-1, 1]', () => {
    const engine = new DjEngine();
    engine.init();

    engine.setCrossfader(2.0);
    expect(engine.crossfader).toBe(1.0);
    engine.setCrossfader(-2.0);
    expect(engine.crossfader).toBe(-1.0);
  });

  it('drives the real engine with equal-power gains at hard left/center/hard right', () => {
    const engine = new DjEngine();
    engine.init();
    const gainOf = (node) => node.gain.value;

    engine.setCrossfader(-1.0);
    expect(gainOf(engine.crossfaderGainL)).toBeCloseTo(1.0, 5);
    expect(gainOf(engine.crossfaderGainR)).toBeCloseTo(0.0, 5);

    engine.setCrossfader(1.0);
    expect(gainOf(engine.crossfaderGainL)).toBeCloseTo(0.0, 5);
    expect(gainOf(engine.crossfaderGainR)).toBeCloseTo(1.0, 5);

    engine.setCrossfader(0.0);
    const center = Math.SQRT1_2; // cos(pi/4) — -3 dB equal power
    expect(gainOf(engine.crossfaderGainL)).toBeCloseTo(center, 5);
    expect(gainOf(engine.crossfaderGainR)).toBeCloseTo(center, 5);
    expect(gainOf(engine.crossfaderGainL) ** 2 + gainOf(engine.crossfaderGainR) ** 2).toBeCloseTo(1.0, 5);
  });

  it('is safe to call before init()', () => {
    const engine = new DjEngine();
    expect(() => engine.setCrossfader(0.5)).not.toThrow();
    expect(engine.crossfader).toBe(0.5);
  });
});

describe('DjEngine syncDecks()', () => {
  it('does nothing before init()', () => {
    const engine = new DjEngine();
    expect(() => engine.syncDecks('deck1')).not.toThrow();
  });

  it('syncs the target deck to the source deck BPM', () => {
    const engine = new DjEngine();
    engine.init();

    engine.deck1.bpm = 128;
    engine.deck1.updateBpm();
    engine.deck1.setPitch(0); // triggers notifyChange -> refreshes engine.deck1State

    const syncToSpy = vi.spyOn(engine.deck2, 'syncTo');
    engine.syncDecks('deck1');

    expect(syncToSpy).toHaveBeenCalledWith(128);
  });

  it('ignores unknown source ids', () => {
    const engine = new DjEngine();
    engine.init();
    const syncToSpy1 = vi.spyOn(engine.deck1, 'syncTo');
    const syncToSpy2 = vi.spyOn(engine.deck2, 'syncTo');

    engine.syncDecks('deck3');
    expect(syncToSpy1).not.toHaveBeenCalled();
    expect(syncToSpy2).not.toHaveBeenCalled();
  });
});
