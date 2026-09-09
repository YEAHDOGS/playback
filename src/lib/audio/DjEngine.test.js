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
