/**
 * Feature flags for the Playback UI.
 *
 * Flags are opt-in via Vite env vars (e.g. `VITE_SHOW_LOAD_ERROR_BADGE=1 npm run dev`).
 * Everything defaults to OFF so new visuals never ship without Brandon's sign-off.
 * Flags are read at call time (not module load) so tests can stub `import.meta.env`.
 */

/**
 * Whether the broken-track badge renders in the Mixer when a deck is in loadError.
 * @returns {boolean}
 */
export function isLoadErrorBadgeEnabled() {
  return import.meta.env?.VITE_SHOW_LOAD_ERROR_BADGE === '1';
}

/**
 * Whether a deck state carries a media load error.
 * @param {object} deckState - state object published by AudioDeck.getState()
 * @returns {boolean}
 */
export function deckHasLoadError(deckState) {
  return !!deckState?.loadError;
}

/**
 * Whether the broken-track badge should render for a deck right now.
 * @param {object} deckState - state object published by AudioDeck.getState()
 * @returns {boolean}
 */
export function loadErrorBadgeVisible(deckState) {
  return isLoadErrorBadgeEnabled() && deckHasLoadError(deckState);
}
