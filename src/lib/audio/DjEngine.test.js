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
});
