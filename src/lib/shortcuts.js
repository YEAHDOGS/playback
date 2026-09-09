/**
 * Keyboard shortcuts for the Playback console.
 *
 * Kept as a pure, UI-free module so it stays unit-testable: the handler is
 * a function of the key event plus small engine/deck accessors, never of
 * the DOM. The only DOM touch is the event target, used to stay inert while
 * the user is typing.
 */

export const SEEK_SECONDS = 10;
export const VOLUME_STEP = 0.1;

/** Element tags whose focused input must swallow every shortcut. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True when the event target is a text-entry element, in which case all
 * shortcuts stay inert so typing (e.g. the track library search box) is
 * never hijacked.
 * @param {EventTarget|null} target - event.target from the keydown
 * @returns {boolean}
 */
export function isTypingTarget(target) {
  // `Element` does not exist outside a DOM environment (SSR, node tests).
  if (!target || typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  // Fallback for environments without the isContentEditable getter (jsdom):
  // an explicit contenteditable attribute ("" or "true") counts as typing.
  const ce = typeof target.getAttribute === 'function' && target.getAttribute('contenteditable');
  if (ce !== null && ce !== false && String(ce).toLowerCase() !== 'false') return true;
  return TYPING_TAGS.has(target.tagName);
}

/**
 * Renders the shortcut rows for the help overlay. Single source of truth:
 * keys shown in the overlay always match what the handler listens for.
 */
export const SHORTCUT_ROWS = [
  { keys: ['Space'], action: 'play_pause' },
  { keys: ['←', '→'], action: 'seek' },
  { keys: ['↑', '↓'], action: 'volume' },
  { keys: ['M'], action: 'mute' },
  { keys: ['?'], action: 'overlay' },
  { keys: ['Esc'], action: 'close' },
];

/**
 * Creates the window keydown handler.
 *
 * @param {Object} deps
 * @param {() => Object|null} deps.getEngine - DjEngine (master volume + mute)
 * @param {() => Object|null} deps.getDeck - target AudioDeck (play/pause, seek)
 * @param {() => boolean} deps.isOverlayOpen - whether the help overlay is open
 * @param {(open: boolean) => void} deps.setOverlayOpen - open/close the overlay
 * @returns {(e: KeyboardEvent) => void} handler to attach/detach on window
 */
export function createShortcutHandler({ getEngine, getDeck, isOverlayOpen, setOverlayOpen }) {
  return function handleKeydown(e) {
    // Escape always closes the help overlay, even while typing.
    if (e.key === 'Escape') {
      if (isOverlayOpen()) {
        setOverlayOpen(false);
        e.preventDefault();
      }
      return;
    }

    // Never hijack keystrokes aimed at a text field.
    if (isTypingTarget(e.target)) return;

    // Leave OS/browser-modified chords (Ctrl/Cmd/Alt) alone.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const engine = getEngine();
    if (!engine) return;

    switch (e.key) {
      case ' ': {
        const deck = getDeck();
        if (deck) {
          deck.togglePlay();
          e.preventDefault(); // stop focused buttons re-triggering
        }
        return;
      }
      case 'ArrowLeft': {
        const deck = getDeck();
        if (deck) {
          deck.seekBy(-SEEK_SECONDS);
          e.preventDefault(); // stop horizontal scroll
        }
        return;
      }
      case 'ArrowRight': {
        const deck = getDeck();
        if (deck) {
          deck.seekBy(SEEK_SECONDS);
          e.preventDefault();
        }
        return;
      }
      case 'ArrowUp':
        engine.setMasterVolume(engine.masterVolume + VOLUME_STEP);
        e.preventDefault(); // stop page scroll
        return;
      case 'ArrowDown':
        engine.setMasterVolume(engine.masterVolume - VOLUME_STEP);
        e.preventDefault();
        return;
      case 'm':
      case 'M':
        engine.toggleMute();
        return;
      case '?':
        setOverlayOpen(!isOverlayOpen());
        e.preventDefault();
        return;
      default:
        return;
    }
  };
}
