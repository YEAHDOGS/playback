// @vitest-environment jsdom
/**
 * Regression tests for the keyboard shortcuts module.
 *
 * Guards the two things users will notice most: (1) shortcuts must never
 * fire while typing in a text field, and (2) Space must toggle play/pause.
 * Also pins the seek clamp ([0, duration]), volume step, mute, and the
 * `?` overlay toggle / Escape dismiss on the REAL AudioDeck/DjEngine
 * classes with a mocked Web Audio stack (no browser needed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AudioDeck from './audio/AudioDeck.js';
import DjEngine from './audio/DjEngine.js';
import { isTypingTarget, createShortcutHandler, SEEK_SECONDS, VOLUME_STEP } from './shortcuts.js';

// ---------------------------------------------------------------------------
// Minimal Web Audio mocks (same shape as the engine unit tests use)
// ---------------------------------------------------------------------------

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
  addEventListener(name, cb) { this.listeners[name] = cb; }
  removeEventListener() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
}

function makeAudioParam() {
  const param = { value: 0 };
  param.setValueAtTime = vi.fn((v) => { param.value = v; });
  return param;
}
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
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
  }
  createGain() { return makeAudioNode(); }
  createBiquadFilter() { return makeAudioNode(); }
  createAnalyser() {
    const node = makeAudioNode();
    node.frequencyBinCount = 16;
    node.getByteFrequencyData = (arr) => arr.fill(0);
    return node;
  }
  createMediaElementSource() { return makeAudioNode(); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.Audio = MockAudio;
  globalThis.window = { AudioContext: MockAudioContext };
});

/** Builds a handler wired to a real engine; deck1 is the shortcut target. */
function setupHandler() {
  const engine = new DjEngine();
  engine.init();
  const deck = engine.deck1;
  deck.duration = 120; // simulate a loaded 2-minute track
  deck.audio.duration = 120;

  let overlayOpen = false;
  const setOverlayOpen = vi.fn((open) => { overlayOpen = open; });
  const handler = createShortcutHandler({
    getEngine: () => engine,
    getDeck: () => deck,
    isOverlayOpen: () => overlayOpen,
    setOverlayOpen,
  });

  /** Dispatches a keydown on `target` straight into the handler. */
  function press(key, { target = document.body, modifiers = {} } = {}) {
    // Real keydown events are cancelable; match that so defaultPrevented works.
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
    Object.defineProperty(event, 'target', { value: target });
    handler(event);
    return event;
  }

  return { engine, deck, handler, press, setOverlayOpen, isOverlayOpen: () => overlayOpen };
}

// ---------------------------------------------------------------------------
// isTypingTarget()
// ---------------------------------------------------------------------------

describe('isTypingTarget()', () => {
  it.each(['input', 'textarea', 'select'])('stays inert inside <%s>', (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it('stays inert inside contenteditable elements', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true'); // (IDL setter does not reflect in jsdom)
    expect(isTypingTarget(div)).toBe(true);
  });

  it('does not treat plain elements as typing targets', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });

  it('handles null/undefined targets without throwing', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler: Space play/pause + inert-while-typing
// ---------------------------------------------------------------------------

describe('shortcut handler', () => {
  it('Space toggles play/pause on the target deck', () => {
    const { deck, press } = setupHandler();
    const toggleSpy = vi.spyOn(deck, 'togglePlay');

    press(' ');
    expect(toggleSpy).toHaveBeenCalledTimes(1);

    press(' ');
    expect(toggleSpy).toHaveBeenCalledTimes(2);
  });

  it('Space preventDefaults so focused buttons do not re-trigger', () => {
    const { press } = setupHandler();
    const event = press(' ', { target: document.createElement('button') });
    expect(event.defaultPrevented).toBe(true);
  });

  it('never fires while typing in an input', () => {
    const { deck, press } = setupHandler();
    const toggleSpy = vi.spyOn(deck, 'togglePlay');
    const seekSpy = vi.spyOn(deck, 'seekBy');
    const input = document.createElement('input');

    press(' ', { target: input });
    press('ArrowLeft', { target: input });
    press('m', { target: input });

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(seekSpy).not.toHaveBeenCalled();
  });

  it('never fires while typing in textarea, select or contenteditable', () => {
    const { deck, press } = setupHandler();
    const toggleSpy = vi.spyOn(deck, 'togglePlay');

    const textarea = document.createElement('textarea');
    press(' ', { target: textarea });

    const select = document.createElement('select');
    press(' ', { target: select });

    const rich = document.createElement('div');
    rich.setAttribute('contenteditable', 'true'); // (IDL setter does not reflect in jsdom)
    press(' ', { target: rich });

    expect(toggleSpy).not.toHaveBeenCalled();
  });

  it('ignores Ctrl/Cmd/Alt-modified chords', () => {
    const { deck, press } = setupHandler();
    const toggleSpy = vi.spyOn(deck, 'togglePlay');

    press(' ', { modifiers: { ctrlKey: true } });
    press(' ', { modifiers: { metaKey: true } });
    press('m', { modifiers: { altKey: true } });

    expect(toggleSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Handler: seek with [0, duration] clamping (real AudioDeck)
// ---------------------------------------------------------------------------

describe('seek shortcuts', () => {
  it('ArrowLeft/ArrowRight seek ∓SEEK_SECONDS on the target deck', () => {
    const { deck, press } = setupHandler();
    const seekSpy = vi.spyOn(deck, 'seekBy');

    press('ArrowRight');
    expect(seekSpy).toHaveBeenCalledWith(SEEK_SECONDS);

    press('ArrowLeft');
    expect(seekSpy).toHaveBeenCalledWith(-SEEK_SECONDS);
  });

  it('AudioDeck.seekBy() clamps to [0, duration]', () => {
    const { deck } = setupHandler();

    deck.audio.currentTime = 5;
    deck.seekBy(-SEEK_SECONDS);
    expect(deck.audio.currentTime).toBe(0);

    deck.audio.currentTime = 115;
    deck.seekBy(SEEK_SECONDS);
    expect(deck.audio.currentTime).toBe(120);
  });

  it('AudioDeck.seekBy() is a no-op when no track duration is known', () => {
    const { deck } = setupHandler();
    deck.duration = 0;
    deck.audio.currentTime = 7;
    deck.seekBy(-SEEK_SECONDS);
    expect(deck.audio.currentTime).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Handler: master volume + mute (real DjEngine)
// ---------------------------------------------------------------------------

describe('volume shortcuts', () => {
  it('ArrowUp/ArrowDown step master volume by VOLUME_STEP, clamped [0, 1]', () => {
    const { engine, press } = setupHandler();

    press('ArrowUp');
    expect(engine.masterVolume).toBeCloseTo(0.8 + VOLUME_STEP);

    press('ArrowDown');
    press('ArrowDown');
    expect(engine.masterVolume).toBeCloseTo(0.8 - VOLUME_STEP);

    // floor clamp
    for (let i = 0; i < 20; i++) press('ArrowDown');
    expect(engine.masterVolume).toBe(0);

    // ceiling clamp
    for (let i = 0; i < 30; i++) press('ArrowUp');
    expect(engine.masterVolume).toBe(1);
  });

  it('M toggles mute and restores the previous volume', () => {
    const { engine, press } = setupHandler();

    press('m');
    expect(engine.masterVolume).toBe(0);

    press('M');
    expect(engine.masterVolume).toBeCloseTo(0.8);
  });
});

// ---------------------------------------------------------------------------
// Handler: ? overlay + Escape dismiss
// ---------------------------------------------------------------------------

describe('shortcuts overlay', () => {
  it('? toggles the help overlay', () => {
    const { press, setOverlayOpen, isOverlayOpen } = setupHandler();

    press('?');
    expect(setOverlayOpen).toHaveBeenCalledWith(true);

    press('?');
    expect(isOverlayOpen()).toBe(false);
  });

  it('Escape closes the overlay, even while typing', () => {
    const { press, setOverlayOpen } = setupHandler();

    press('?'); // open it
    setOverlayOpen.mockClear();

    press('Escape', { target: document.createElement('input') });
    expect(setOverlayOpen).toHaveBeenCalledWith(false);
  });

  it('Escape is a no-op when the overlay is not open', () => {
    const { press, setOverlayOpen } = setupHandler();
    press('Escape');
    expect(setOverlayOpen).not.toHaveBeenCalled();
  });

  it('does nothing when the engine is missing', () => {
    const handler = createShortcutHandler({
      getEngine: () => null,
      getDeck: () => null,
      isOverlayOpen: () => false,
      setOverlayOpen: () => { throw new Error('should not open'); },
    });
    const event = new KeyboardEvent('keydown', { key: ' ' });
    expect(() => handler(event)).not.toThrow();
  });
});
