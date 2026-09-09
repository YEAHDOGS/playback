/**
 * Keyboard transport shortcuts for the Playback DJ console.
 * Native keydown handling only — no libraries.
 *
 * Default map (documented in README):
 *   Space              Play/pause deck 1
 *   X                  Play/pause deck 2
 *   C / V              Cue-play deck 1 / deck 2
 *   S                  Sync deck 1 to deck 2's tempo
 *   ArrowLeft/Right    Nudge crossfader -/+ 0.05
 *   ArrowUp/Down       Master volume +/-
 *
 * Shortcuts are ignored while typing in inputs, selects, textareas,
 * or contentEditable elements so library search keeps working.
 */

const CROSSFADER_STEP = 0.05;
const VOLUME_STEP = 0.05;

/** @param {KeyboardEvent} e */
function isTypingTarget(e) {
  const el = e.target;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest('input, select, textarea, [contenteditable="true"]') !== null;
}

/**
 * Attach shortcuts to the window; returns a detach function.
 * @param {import('./audio/DjEngine.js').default} engine
 */
export function attachKeyboardShortcuts(engine) {
  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (!engine || isTypingTarget(e)) return;

    const deck1 = engine.deck1;
    const deck2 = engine.deck2;

    switch (e.code) {
      case 'Space':
        if (!deck1) return;
        e.preventDefault();
        deck1.togglePlay();
        return;
      case 'KeyX':
        if (!deck2) return;
        e.preventDefault();
        deck2.togglePlay();
        return;
      case 'KeyC':
        if (!deck1) return;
        deck1.playCue();
        return;
      case 'KeyV':
        if (!deck2) return;
        deck2.playCue();
        return;
      case 'KeyS':
        engine.syncDecks('deck2'); // lock deck 1 to deck 2's tempo
        return;
      case 'ArrowLeft':
        e.preventDefault();
        engine.setCrossfader(engine.crossfader - CROSSFADER_STEP);
        return;
      case 'ArrowRight':
        e.preventDefault();
        engine.setCrossfader(engine.crossfader + CROSSFADER_STEP);
        return;
      case 'ArrowUp':
        e.preventDefault();
        engine.setMasterVolume(engine.masterVolume + VOLUME_STEP);
        return;
      case 'ArrowDown':
        e.preventDefault();
        engine.setMasterVolume(engine.masterVolume - VOLUME_STEP);
        return;
      default:
        return;
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
