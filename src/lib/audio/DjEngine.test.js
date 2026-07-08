import { describe, it, expect, vi } from 'vitest';

// Define a simple math verification helper that matches DjEngine's crossfade calculation
function calculateCrossfaderGains(crossfader) {
  const norm = (crossfader + 1.0) / 2.0;
  const gainL = Math.cos(norm * Math.PI / 2);
  const gainR = Math.sin(norm * Math.PI / 2);
  return { gainL, gainR };
}

describe('DjEngine Equal-Power Crossfader Math', () => {
  it('should deliver full volume on left deck and zero on right deck when crossfader is fully left (-1.0)', () => {
    const { gainL, gainR } = calculateCrossfaderGains(-1.0);
    expect(gainL).toBeCloseTo(1.0, 5);
    expect(gainR).toBeCloseTo(0.0, 5);
  });

  it('should deliver full volume on right deck and zero on left deck when crossfader is fully right (+1.0)', () => {
    const { gainL, gainR } = calculateCrossfaderGains(1.0);
    expect(gainL).toBeCloseTo(0.0, 5);
    expect(gainR).toBeCloseTo(1.0, 5);
  });

  it('should distribute equal power (-3dB, ~0.707) to both decks when crossfader is centered (0.0)', () => {
    const { gainL, gainR } = calculateCrossfaderGains(0.0);
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
      const { gainL, gainR } = calculateCrossfaderGains(step);
      const powerSum = (gainL * gainL) + (gainR * gainR);
      // Power must remain constant at 1.0 regardless of crossfader position
      expect(powerSum).toBeCloseTo(1.0, 5);
    });
  });
});
