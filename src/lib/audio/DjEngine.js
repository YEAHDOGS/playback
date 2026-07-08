import AudioDeck from './AudioDeck.js';

/**
 * DjEngine coordinates multiple decks, master controls, and crossfading.
 */
export default class DjEngine {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
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
    });

    this.deck2 = new AudioDeck('deck2', this.audioContext, (state) => {
      this.deck2State = state;
      this.notifyEngineChange();
    });

    // Connect deck outputs to mixer
    this.deck1.outputNode.connect(this.crossfaderGainL);
    this.deck2.outputNode.connect(this.crossfaderGainR);

    // Set initial crossfader gains
    this.updateCrossfaderGains();

    this.initialized = true;
    this.notifyEngineChange();
  }

  /**
   * Set the master output volume
   * @param {number} vol - 0.0 to 1.0
   */
  setMasterVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.audioContext.currentTime);
    }
    this.notifyEngineChange();
  }

  /**
   * Set crossfader position
   * @param {number} val - -1.0 (Full Left) to +1.0 (Full Right)
   */
  setCrossfader(val) {
    this.crossfader = Math.max(-1.0, Math.min(1.0, val));
    this.updateCrossfaderGains();
    this.notifyEngineChange();
  }

  /**
   * Equal-power crossfader gain curve calculations.
   * Constant power sum prevents volume drops in the center position.
   */
  updateCrossfaderGains() {
    if (!this.crossfaderGainL || !this.crossfaderGainR) return;

    // Map -1..1 to 0..1 range
    const norm = (this.crossfader + 1.0) / 2.0;

    // Equal-power crossfade curve
    // Left gain = cos(x * pi/2)
    // Right gain = sin(x * pi/2)
    const gainL = Math.cos(norm * Math.PI / 2);
    const gainR = Math.sin(norm * Math.PI / 2);

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
