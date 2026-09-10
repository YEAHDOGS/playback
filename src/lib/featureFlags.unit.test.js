import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isLoadErrorBadgeEnabled,
  deckHasLoadError,
  loadErrorBadgeVisible
} from './featureFlags.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('feature flags', () => {
  describe('isLoadErrorBadgeEnabled', () => {
    it('is off by default (no env var set)', () => {
      expect(isLoadErrorBadgeEnabled()).toBe(false);
    });

    it('is off for any value other than "1"', () => {
      vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', 'true');
      expect(isLoadErrorBadgeEnabled()).toBe(false);
      vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '0');
      expect(isLoadErrorBadgeEnabled()).toBe(false);
    });

    it('is on when VITE_SHOW_LOAD_ERROR_BADGE=1', () => {
      vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '1');
      expect(isLoadErrorBadgeEnabled()).toBe(true);
    });
  });

  describe('deckHasLoadError', () => {
    it('is false for empty/null/undefined deck states', () => {
      expect(deckHasLoadError(undefined)).toBe(false);
      expect(deckHasLoadError(null)).toBe(false);
      expect(deckHasLoadError({})).toBe(false);
      expect(deckHasLoadError({ loadError: null })).toBe(false);
    });

    it('is true when the deck carries a loadError object', () => {
      expect(deckHasLoadError({ loadError: { code: 4 } })).toBe(true);
    });
  });

  describe('loadErrorBadgeVisible', () => {
    it('never renders when the flag is off, even with a loadError', () => {
      expect(loadErrorBadgeVisible({ loadError: { code: 4 } })).toBe(false);
    });

    it('does not render with flag on but no loadError', () => {
      vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '1');
      expect(loadErrorBadgeVisible({})).toBe(false);
    });

    it('renders with flag on and a loadError set', () => {
      vi.stubEnv('VITE_SHOW_LOAD_ERROR_BADGE', '1');
      expect(loadErrorBadgeVisible({ loadError: { code: 2 } })).toBe(true);
    });
  });
});
