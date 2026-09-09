import { describe, it, expect } from 'vitest';
import DjEngine from './DjEngine.js';

// These tests exercise DjEngine's REAL crossfader implementation via the pure
// static calculateCrossfaderGains(), plus the clamping guards on the engine's
// setters. No Web Audio context needed.

describe('DjEngine Equal-Power Crossfader Math (real implementation)', () => {
  it('should deliver full volume on left deck and zero on right deck when crossfader is fully left (-1.0)', () => {
    const { gainL, gainR } = DjEngine.calculateCrossfaderGains(-1.0);
    expect(gainL).toBeCloseTo(1.0, 5);
    expect(gainR).toBeCloseTo(0.0, 5);
  });

  it('should deliver full volume on right deck and zero on left deck when crossfader is fully right (+1.0)', () => {
    const { gainL, gainR } = DjEngine.calculateCrossfaderGains(1.0);
    expect(gainL).toBeCloseTo(0.0, 5);
    expect(gainR).toBeCloseTo(1.0, 5);
  });

  it('should distribute equal power (-3dB, ~0.707) to both decks when crossfader is centered (0.0)', () => {
    const { gainL, gainR } = DjEngine.calculateCrossfaderGains(0.0);
    const expectedCenterGain = Math.cos(Math.PI / 4); // ~0.707106
    expect(gainL).toBeCloseTo(expectedCenterGain, 5);
    expect(gainR).toBeCloseTo(expectedCenterGain, 5);

    // Equal-power sum check: gainL^2 + gainR^2 should equal 1.0
    const powerSum = (gainL * gainL) + (gainR * gainR);
    expect(powerSum).toBeCloseTo(1.0, 5);
  });

  it('should verify linear crossfade increments sum to constant power', () => {
    const steps = [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75];
    steps.forEach(step => {
      const { gainL, gainR } = DjEngine.calculateCrossfaderGains(step);
      const powerSum = (gainL * gainL) + (gainR * gainR);
      // Power must remain constant at 1.0 regardless of crossfader position
      expect(powerSum).toBeCloseTo(1.0, 5);
    });
  });
});

describe('DjEngine mixer setter clamps', () => {
  it('should clamp crossfader to [-1, 1] in setCrossfader()', () => {
    const engine = new DjEngine();
    engine.setCrossfader(2.5);
    expect(engine.crossfader).toBe(1.0);
    engine.setCrossfader(-3.0);
    expect(engine.crossfader).toBe(-1.0);
    engine.setCrossfader(0.4);
    expect(engine.crossfader).toBeCloseTo(0.4, 5);
  });

  it('should clamp master volume to [0, 1] in setMasterVolume()', () => {
    const engine = new DjEngine();
    engine.setMasterVolume(1.5);
    expect(engine.masterVolume).toBe(1.0);
    engine.setMasterVolume(-0.2);
    expect(engine.masterVolume).toBe(0.0);
    engine.setMasterVolume(0.55);
    expect(engine.masterVolume).toBeCloseTo(0.55, 5);
  });
});

describe('DjEngine crossfader audio-graph wiring (mocked nodes)', () => {
  // No Web Audio here: inject minimal gain-node stand-ins and assert the
  // engine pushes the pure equal-power gains into the graph, at the right
  // time, whenever setCrossfader() runs.
  function mockGainNode() {
    const calls = [];
    return {
      calls,
      gain: { setValueAtTime: (value, when) => calls.push([value, when]) },
      connect() {},
    };
  }

  function wiredEngine() {
    const engine = new DjEngine();
    engine.crossfaderGainL = mockGainNode();
    engine.crossfaderGainR = mockGainNode();
    engine.audioContext = { currentTime: 123.4 };
    return engine;
  }

  it('should push the pure-calc gains into the graph on setCrossfader()', () => {
    const engine = wiredEngine();
    engine.setCrossfader(1.0);
    const expected = DjEngine.calculateCrossfaderGains(1.0);
    expect(engine.crossfaderGainL.calls).toEqual([[expected.gainL, 123.4]]);
    expect(engine.crossfaderGainR.calls).toEqual([[expected.gainR, 123.4]]);
  });

  it('should update both nodes when the fader moves mid-session', () => {
    const engine = wiredEngine();
    engine.setCrossfader(-0.5);
    engine.setCrossfader(0.0);
    expect(engine.crossfaderGainL.calls).toHaveLength(2);
    expect(engine.crossfaderGainR.calls).toHaveLength(2);
    const last = engine.crossfaderGainL.calls[1];
    const expected = DjEngine.calculateCrossfaderGains(0.0);
    expect(last[0]).toBeCloseTo(expected.gainL, 10);
  });

  it('should be a no-op (never throw) when the audio graph is not built yet', () => {
    const engine = new DjEngine(); // init() not called: no nodes
    expect(() => engine.setCrossfader(0.75)).not.toThrow();
    expect(engine.crossfader).toBeCloseTo(0.75, 5);
  });

  it('should not write to the graph when nodes exist but the context is missing', () => {
    const engine = new DjEngine();
    engine.crossfaderGainL = mockGainNode();
    engine.crossfaderGainR = mockGainNode();
    // audioContext deliberately left unset
    expect(() => engine.setCrossfader(0.5)).not.toThrow();
    expect(engine.crossfader).toBeCloseTo(0.5, 5);
    expect(engine.crossfaderGainL.calls).toHaveLength(0);
    expect(engine.crossfaderGainR.calls).toHaveLength(0);
  });
});

describe('DjEngine non-finite / out-of-range input hardening', () => {
  // Regression: Math.max/min propagate NaN, so a single NaN/undefined
  // (keyboard, MIDI, UI edge) used to poison the fader state and throw a
  // TypeError inside setValueAtTime, unbinding the mixer sliders.

  function wiredEngine() {
    const engine = new DjEngine();
    const mk = () => ({ calls: [], gain: { setValueAtTime: (v, t) => {} }, connect() {} });
    engine.crossfaderGainL = mk();
    engine.crossfaderGainR = mk();
    engine.masterGain = { gain: { setValueAtTime: () => {} } };
    engine.audioContext = { currentTime: 0 };
    return engine;
  }

  it('should reject NaN/undefined/Infinity in setCrossfader() and keep prior state', () => {
    const engine = wiredEngine();
    engine.setCrossfader(0.4);
    expect(engine.crossfader).toBeCloseTo(0.4, 5);
    [NaN, undefined, Infinity, -Infinity].forEach((bad) => {
      expect(() => engine.setCrossfader(bad)).not.toThrow();
      expect(engine.crossfader).toBeCloseTo(0.4, 5);
    });
  });

  it('should reject NaN/undefined/Infinity in setMasterVolume() and keep prior state', () => {
    const engine = wiredEngine();
    engine.setMasterVolume(0.6);
    expect(engine.masterVolume).toBeCloseTo(0.6, 5);
    [NaN, undefined, Infinity, -Infinity].forEach((bad) => {
      expect(() => engine.setMasterVolume(bad)).not.toThrow();
      expect(engine.masterVolume).toBeCloseTo(0.6, 5);
    });
  });

  it('should sanitize calculateCrossfaderGains(): non-finite input collapses to center', () => {
    const center = Math.cos(Math.PI / 4); // ~0.7071
    [NaN, undefined, Infinity, -Infinity].forEach((bad) => {
      const { gainL, gainR } = DjEngine.calculateCrossfaderGains(bad);
      expect(Number.isFinite(gainL)).toBe(true);
      expect(Number.isFinite(gainR)).toBe(true);
      expect(gainL).toBeCloseTo(center, 10);
      expect(gainR).toBeCloseTo(center, 10);
    });
  });

  it('should clamp out-of-range values in calculateCrossfaderGains() to finite [0,1] gains', () => {
    const cases = [
      [5.0, 1.0],     // > 1 behaves as full right
      [-5.0, -1.0],   // < -1 behaves as full left
    ];
    cases.forEach(([input, clamped]) => {
      const a = DjEngine.calculateCrossfaderGains(input);
      const b = DjEngine.calculateCrossfaderGains(clamped);
      expect(a.gainL).toBeCloseTo(b.gainL, 10);
      expect(a.gainR).toBeCloseTo(b.gainR, 10);
      [a.gainL, a.gainR].forEach((g) => {
        expect(Number.isFinite(g)).toBe(true);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
      });
    });
  });

  it('should keep keyboard nudge arithmetic finite even after a bad value arrives', () => {
    // mirrors src/lib/keyboard.js: engine.crossfader +/- step
    const engine = wiredEngine();
    engine.setCrossfader(NaN); // rejected, state stays 0.0
    engine.setCrossfader(engine.crossfader - 0.05);
    expect(Number.isFinite(engine.crossfader)).toBe(true);
    expect(engine.crossfader).toBeCloseTo(-0.05, 10);
  });
});

// --- onTrackEnd hook plumbing ---------------------------------------------------

describe('DjEngine onTrackEnd hook plumbing (mocked browser)', () => {
  // init() needs window.AudioContext + global Audio; both are stubbed here
  // and removed afterwards so the rest of the suite stays pure node.
  function mockAudioContext() {
    const gain = () => ({ gain: { value: 0, setValueAtTime() {} }, connect() {}, disconnect() {} });
    const biquad = () => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect() {}, disconnect() {} });
    return {
      state: 'running',
      currentTime: 0,
      createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
      createBiquadFilter: biquad,
      createGain: gain,
      createAnalyser: () => ({ fftSize: 32, frequencyBinCount: 8, connect() {}, disconnect() {}, getByteFrequencyData(arr) { arr.fill(0); } }),
      resume: () => Promise.resolve(),
      close() {},
      destination: {},
    };
  }

  class MockAudioElement {
    constructor() { this.listeners = {}; this.src = ''; this.currentTime = 0; this.duration = 0; }
    addEventListener(t, cb) { (this.listeners[t] ||= []).push(cb); }
    removeEventListener() {}
    emit(t) { (this.listeners[t] || []).forEach((cb) => cb()); }
    load() {}
    pause() {}
    play() { return Promise.resolve(); }
  }

  let prevWindow;
  let prevAudio;
  function stubBrowser() {
    prevWindow = globalThis.window;
    prevAudio = globalThis.Audio;
    globalThis.window = { AudioContext: function AudioContext() { return mockAudioContext(); } };
    globalThis.Audio = MockAudioElement;
  }
  function unstubBrowser() {
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
    if (prevAudio === undefined) delete globalThis.Audio; else globalThis.Audio = prevAudio;
  }

  it('should forward each deck\u2019s ended event to hooks.onTrackEnd with the right deck id', () => {
    stubBrowser();
    try {
      const seen = [];
      const engine = new DjEngine(() => {}, { onTrackEnd: (id) => seen.push(id) });
      engine.init();
      engine.deck1.audio.emit('ended');
      engine.deck2.audio.emit('ended');
      expect(seen).toEqual(['deck1', 'deck2']);
      engine.destroy();
    } finally {
      unstubBrowser();
    }
  });

  it('should init fine with no hooks (backward compatible)', () => {
    stubBrowser();
    try {
      const engine = new DjEngine();
      expect(() => engine.init()).not.toThrow();
      expect(() => engine.deck1.audio.emit('ended')).not.toThrow();
      engine.destroy();
    } finally {
      unstubBrowser();
    }
  });
});
