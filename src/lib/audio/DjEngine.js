import AudioDeck from './AudioDeck.js';

/**
 * DjEngine coordinates multiple decks, master controls, and crossfading.
 */
export default class DjEngine {
  /**
   * @param {Function} [onChange] - state change callback
   * @param {Object} [hooks] - event hooks forwarded to each deck:
   *   { onTrackEnd(deckId) } fires when a deck's track plays to completion
   *   (queue auto-advance wires in here).
   */
  constructor(onChange, hooks = {}) {
    this.onChange = onChange || (() => {});
    this.hooks = hooks || {};
    this.initialized = false;
    this.masterVolume = 0.8;
    this.crossfader = 0.0; // -1.0 (Left deck only) to +1.0 (Right deck only)

    // State placeholders for decks
    this.deck1State = null;
    this.deck2State = null;
  }

  /**
   * Initialize AudioContext and Audio Nodes.
   * Must be called in response to a user gesture (e.g. clicking "Start DJing" button)
   */
  init() {
    if (this.initialized) return;

    // 1. Create AudioContext (fallback for standard and webkit browsers)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass();

    // 2. Crossfader gain nodes
    this.crossfaderGainL = this.audioContext.createGain();
    this.crossfaderGainR = this.audioContext.createGain();

    // 3. Master volume gain node
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.masterVolume;

    // Connect graph:
    // Deck L -> Crossfader L \
    //                          +-> MasterGain -> Destination
    // Deck R -> Crossfader R /
    this.crossfaderGainL.connect(this.masterGain);
    this.crossfaderGainR.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);

    // Create the two decks
    this.deck1 = new AudioDeck('deck1', this.audioContext, (state) => {
      this.deck1State = state;
      this.notifyEngineChange();
    }, { onTrackEnd: (deckId) => this.hooks.onTrackEnd?.(deckId) });

    this.deck2 = new AudioDeck('deck2', this.audioContext, (state) => {
      this.deck2State = state;
      this.notifyEngineChange();
    }, { onTrackEnd: (deckId) => this.hooks.onTrackEnd?.(deckId) });

    // Connect deck outputs to mixer
    this.deck1.outputNode.connect(this.crossfaderGainL);
    this.deck2.outputNode.connect(this.crossfaderGainR);

    // Set initial crossfader gains
    this.updateCrossfaderGains();

    this.initialized = true;
    this.notifyEngineChange();
  }

  /**
   * Set the master output volume. Non-finite input (NaN/undefined/Infinity)
   * is rejected: it would poison masterVolume and throw when written to an
   * AudioParam, leaving the UI slider bound to a NaN state.
   * @param {number} vol - 0.0 to 1.0
   */
  setMasterVolume(vol) {
    if (!Number.isFinite(vol)) return;
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.audioContext.currentTime);
    }
    this.notifyEngineChange();
  }

  /**
   * Set crossfader position. Non-finite input (NaN/undefined/Infinity) is
   * rejected: without this, one bad value (e.g. from a MIDI/controller
   * hiccup) would set this.crossfader to NaN, throw in
   * updateCrossfaderGains() via setValueAtTime(NaN), and every subsequent
   * keyboard nudge (engine.crossfader +/- step) would stay NaN forever,
   * unbinding the crossfader slider in the UI.
   * @param {number} val - -1.0 (Full Left) to +1.0 (Full Right)
   */
  setCrossfader(val) {
    if (!Number.isFinite(val)) return;
    this.crossfader = Math.max(-1.0, Math.min(1.0, val));
    this.updateCrossfaderGains();
    this.notifyEngineChange();
  }

  /**
   * Pure equal-power crossfader gain calculation, kept static so it is
   * unit-testable without a Web Audio context.
   * Constant power sum (gainL^2 + gainR^2 = 1) prevents volume drops in
   * the center position.
   * Sanitizes its input: non-finite values collapse to center (0.0) and
   * out-of-range values are clamped, so the returned gains are ALWAYS
   * finite numbers in [0, 1] — safe to write to any AudioParam and free
   * of per-channel clipping risk regardless of channel count.
   * @param {number} crossfader - -1.0 (full left) to +1.0 (full right)
   * @returns {{ gainL: number, gainR: number }}
   */
  static calculateCrossfaderGains(crossfader) {
    // Map -1..1 to 0..1 range
    const norm = (Math.max(-1.0, Math.min(1.0, Number.isFinite(crossfader) ? crossfader : 0.0)) + 1.0) / 2.0;

    // Equal-power crossfade curve
    // Left gain = cos(x * pi/2)
    // Right gain = sin(x * pi/2)
    return {
      gainL: Math.cos(norm * Math.PI / 2),
      gainR: Math.sin(norm * Math.PI / 2),
    };
  }

  /**
   * Applies the equal-power crossfader gains to the audio graph.
   */
  updateCrossfaderGains() {
    if (!this.crossfaderGainL || !this.crossfaderGainR || !this.audioContext) return;

    const { gainL, gainR } = DjEngine.calculateCrossfaderGains(this.crossfader);
    this.crossfaderGainL.gain.setValueAtTime(gainL, this.audioContext.currentTime);
    this.crossfaderGainR.gain.setValueAtTime(gainR, this.audioContext.currentTime);
  }

  /**
   * Syncs the BPM of target deck to matching source deck BPM
   * @param {string} sourceId - 'deck1' | 'deck2'
   */
  syncDecks(sourceId) {
    if (!this.initialized) return;

    if (sourceId === 'deck1' && this.deck1State && this.deck2) {
      this.deck2.syncTo(this.deck1State.currentBpm);
    } else if (sourceId === 'deck2' && this.deck2State && this.deck1) {
      this.deck1.syncTo(this.deck2State.currentBpm);
    }
  }

  notifyEngineChange() {
    this.onChange({
      initialized: this.initialized,
      masterVolume: this.masterVolume,
      crossfader: this.crossfader,
      deck1: this.deck1State,
      deck2: this.deck2State
    });
  }

  destroy() {
    if (this.deck1) this.deck1.destroy();
    if (this.deck2) this.deck2.destroy();
    try {
      if (this.crossfaderGainL) this.crossfaderGainL.disconnect();
      if (this.crossfaderGainR) this.crossfaderGainR.disconnect();
      if (this.masterGain) this.masterGain.disconnect();
      if (this.audioContext) this.audioContext.close();
    } catch (e) {
      console.warn("Error destroying DjEngine context:", e);
    }
  }
}
