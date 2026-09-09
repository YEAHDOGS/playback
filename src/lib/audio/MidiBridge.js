/**
 * MidiBridge connects a hardware MIDI DJ controller to the DjEngine via the
 * Web MIDI API. Native browser API only — no npm packages.
 *
 * The default binding map covers a generic 2-deck controller layout. Every
 * controller speaks its own dialect, so unmapped messages are reported
 * through `onUnhandled` (console + callback) to make remapping easy:
 * connect your controller, wiggle a knob, read the logged message, and
 * override DEFAULT_MIDI_MAP entries with your device's numbers.
 *
 * Web MIDI requires a secure context (https or localhost). Access is only
 * requested after the user clicks "Connect" — never on page load.
 */

/** @typedef {'cc' | 'note'} MidiControlType */
/** @typedef {{ type: MidiControlType, channel: number, number: number }} MidiBinding */

// MIDI status byte masks
const STATUS_MASK = 0xf0;
const CHANNEL_MASK = 0x0f;
const CC_STATUS = 0xb0;
const NOTE_ON_STATUS = 0x90;
const NOTE_OFF_STATUS = 0x80;
const MAX_MIDI_VALUE = 127;

// Control surface actions addressable by bindings
const ACTION_MASTER_VOLUME = 'masterVolume';
const ACTION_CROSSFADER = 'crossfader';
const ACTION_DECK1_VOLUME = 'deck1Volume';
const ACTION_DECK2_VOLUME = 'deck2Volume';
const ACTION_DECK1_PLAY_PAUSE = 'deck1PlayPause';
const ACTION_DECK2_PLAY_PAUSE = 'deck2PlayPause';
const ACTION_DECK1_CUE = 'deck1Cue';
const ACTION_DECK2_CUE = 'deck2Cue';
const ACTION_DECK1_SYNC = 'deck1Sync';
const ACTION_DECK2_SYNC = 'deck2Sync';

/**
 * Default control map for a generic 2-deck DJ controller.
 * Override any entry (or pass a full map) when constructing MidiBridge
 * to match your hardware. Channels are 0-indexed (0 = MIDI channel 1).
 * @type {Record<string, MidiBinding>}
 */
export const DEFAULT_MIDI_MAP = {
  [ACTION_MASTER_VOLUME]: { type: 'cc', channel: 0, number: 7 },
  [ACTION_CROSSFADER]: { type: 'cc', channel: 0, number: 8 },
  [ACTION_DECK1_VOLUME]: { type: 'cc', channel: 0, number: 16 },
  [ACTION_DECK2_VOLUME]: { type: 'cc', channel: 0, number: 17 },
  [ACTION_DECK1_PLAY_PAUSE]: { type: 'note', channel: 0, number: 60 },
  [ACTION_DECK2_PLAY_PAUSE]: { type: 'note', channel: 0, number: 61 },
  [ACTION_DECK1_CUE]: { type: 'note', channel: 0, number: 62 },
  [ACTION_DECK2_CUE]: { type: 'note', channel: 0, number: 63 },
  [ACTION_DECK1_SYNC]: { type: 'note', channel: 0, number: 64 },
  [ACTION_DECK2_SYNC]: { type: 'note', channel: 0, number: 65 }
};

/**
 * Bridge between Web MIDI input devices and a DjEngine instance.
 */
export default class MidiBridge {
  /**
   * @param {import('./DjEngine.js').default} engine - Initialized DjEngine to drive
   * @param {Object} [options]
   * @param {Record<string, MidiBinding>} [options.map] - Binding overrides (merged over DEFAULT_MIDI_MAP)
   * @param {Function} [options.onChange] - Called with bridge status snapshots
   * @param {Function} [options.onUnhandled] - Called with {type, channel, number, value} for unmapped messages
   */
  constructor(engine, options = {}) {
    this.engine = engine;
    this.map = { ...DEFAULT_MIDI_MAP, ...(options.map || {}) };
    this.onChange = options.onChange || (() => {});
    this.onUnhandled = options.onUnhandled || (() => {});

    // 'idle' | 'unsupported' | 'denied' | 'connecting' | 'connected' | 'error'
    this.status = 'idle';
    this.devices = [];
    this.midiAccess = null;

    this.handleMessage = this.handleMessage.bind(this);
    this.handleStateChange = this.handleStateChange.bind(this);
    this.notifyChange();
  }

  get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  /**
   * Request MIDI access and attach to all current + future input devices.
   * Must be called from a user gesture.
   */
  async connect() {
    if (!this.supported) {
      this.status = 'unsupported';
      this.notifyChange();
      return;
    }
    if (this.status === 'connecting' || this.status === 'connected') return;

    this.status = 'connecting';
    this.notifyChange();

    try {
      this.midiAccess = await navigator.requestMIDIAccess();
    } catch (e) {
      console.warn('MIDI access denied or unavailable:', e);
      this.status = 'denied';
      this.notifyChange();
      return;
    }

    this.midiAccess.addEventListener('statechange', this.handleStateChange);
    this.refreshDevices();
    this.status = this.devices.length > 0 ? 'connected' : 'connected';
    this.notifyChange();
  }

  handleStateChange() {
    this.refreshDevices();
    this.notifyChange();
  }

  refreshDevices() {
    if (!this.midiAccess) return;
    this.devices = [];
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = this.handleMessage;
      this.devices.push({ id: input.id, name: input.name || 'Unnamed MIDI device', state: input.state });
    }
  }

  /**
   * Route one raw MIDI message to the mapped engine action.
   * @param {MIDIMessageEvent} event
   */
  handleMessage(event) {
    const data = event.data;
    if (!data || data.length < 3) return;

    const statusByte = data[0] & STATUS_MASK;
    const channel = data[0] & CHANNEL_MASK;
    const number = data[1];
    const value = data[2];

    const isNoteOn = statusByte === NOTE_ON_STATUS && value > 0;
    const isCC = statusByte === CC_STATUS;
    if (!isNoteOn && !isCC && statusByte !== NOTE_OFF_STATUS) return;

    const type = isCC ? 'cc' : 'note';
    const action = this.findAction(type, channel, number);
    if (!action) {
      this.onUnhandled({ type, channel, number, value });
      return;
    }

    if (isCC) this.applyContinuous(action, value / MAX_MIDI_VALUE);
    else if (isNoteOn) this.applyTrigger(action);
  }

  findAction(type, channel, number) {
    for (const [action, binding] of Object.entries(this.map)) {
      if (binding.type === type && binding.channel === channel && binding.number === number) return action;
    }
    return null;
  }

  /** Map a 0..1 fader value onto continuous mixer controls. */
  applyContinuous(action, normalized) {
    if (!this.engine) return;
    if (action === ACTION_MASTER_VOLUME) this.engine.setMasterVolume(normalized);
    else if (action === ACTION_CROSSFADER) this.engine.setCrossfader(normalized * 2 - 1);
    else if (action === ACTION_DECK1_VOLUME && this.engine.deck1) this.engine.deck1.setVolume(normalized);
    else if (action === ACTION_DECK2_VOLUME && this.engine.deck2) this.engine.deck2.setVolume(normalized);
  }

  /** Fire one-shot transport controls on note-on. */
  applyTrigger(action) {
    if (!this.engine) return;
    const deck1 = this.engine.deck1;
    const deck2 = this.engine.deck2;
    if (action === ACTION_DECK1_PLAY_PAUSE && deck1) deck1.togglePlay();
    else if (action === ACTION_DECK2_PLAY_PAUSE && deck2) deck2.togglePlay();
    else if (action === ACTION_DECK1_CUE && deck1) deck1.playCue();
    else if (action === ACTION_DECK2_CUE && deck2) deck2.playCue();
    else if (action === ACTION_DECK1_SYNC) this.engine.syncDecks('deck2');
    else if (action === ACTION_DECK2_SYNC) this.engine.syncDecks('deck1');
  }

  notifyChange() {
    this.onChange({
      status: this.status,
      supported: this.supported,
      devices: this.devices.map((d) => ({ ...d }))
    });
  }

  destroy() {
    if (this.midiAccess) {
      this.midiAccess.removeEventListener('statechange', this.handleStateChange);
      for (const input of this.midiAccess.inputs.values()) input.onmidimessage = null;
      this.midiAccess = null;
    }
    this.devices = [];
    this.status = 'idle';
  }
}
