/**
 * AudioDeck class represents one of the two DJ decks.
 * Decouples audio playback, EQ, gain nodes, and analysers from presentation.
 */

// Loudness-guard constants: per-track normalization attenuates hot masters
// toward a reference level so switching demo tracks can't blast the listener.
const TARGET_LOUDNESS_PEAK_AVG = 0.45; // reference average of decoded waveform peaks (0..1)
const TARGET_LOUDNESS_DB = -14;        // reference integrated loudness when track metadata supplies dB
const MIN_TRACK_GAIN = 0.25;           // max -12dB attenuation; never mutes the deck
const MAX_TRACK_GAIN = 1.0;            // attenuate-only: boosting risks clipping into the EQ stack

import { isPersistableUrl } from '../queue/PlaybackQueue.js';

export default class AudioDeck {
  /**
   * @param {string} id - Deck ID ('deck1' or 'deck2')
   * @param {AudioContext} audioContext - The shared audio context
   * @param {Function} onChange - Callback triggered when state updates
   * @param {Object} [hooks] - Optional event hooks: { onTrackEnd(deckId) }
   *   fired when the loaded track plays to completion. Pure transport —
   *   queue auto-advance wires in here without the deck knowing the queue.
   */
  constructor(id, audioContext, onChange, hooks = {}) {
    this.id = id;
    this.audioContext = audioContext;
    this.onChange = onChange || (() => {});
    this.hooks = hooks || {};
    this.pendingSeek = 0; // resume offset (seconds) applied on loadedmetadata

    // State Variables
    this.playing = false;
    this.loadedTrack = null;
    this.currentTime = 0;
    this.duration = 0;
    this.pitch = 0; // -0.16 to +0.16 (±16%)
    this.bpm = 120; // Default original BPM
    this.currentBpm = 120;
    this.pitchRange = 0.08; // default ±8%
    this.volume = 1.0;
    this.eqLow = 0;  // -12dB to +12dB
    this.eqMid = 0;  // -12dB to +12dB
    this.eqHigh = 0; // -12dB to +12dB
    this.cuePoint = 0; // Cue position in seconds
    this.isDecoding = false;
    this.waveformPeaks = []; // downsampled peaks for visualizer
    this.trackGain = 1.0; // loudness-guard attenuation multiplier (0.25..1); applied under deck volume

    // HTML5 Audio Element
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.loop = false;

    // Web Audio Nodes setup
    this.setupAudioGraph();

    // Event Listeners for Audio element
    this.setupListeners();

    // Publish initial state
    this.notifyChange();
  }

  /**
   * Build the audio node pipeline.
   * MediaSource -> LowShelfFilter -> PeakingFilter -> HighShelfFilter -> VolumeGain -> Analyser
   */
  setupAudioGraph() {
    try {
      this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
    } catch (e) {
      // In case element is already connected or context is closed
      console.warn("MediaElementSource failed to create, reusing context:", e);
    }

    // 1. Equalizer Filters
    this.lowFilter = this.audioContext.createBiquadFilter();
    this.lowFilter.type = 'lowshelf';
    this.lowFilter.frequency.value = 250; // Low frequency cutoff
    this.lowFilter.gain.value = 0;

    this.midFilter = this.audioContext.createBiquadFilter();
    this.midFilter.type = 'peaking';
    this.midFilter.frequency.value = 1000; // Mid band frequency
    this.midFilter.Q.value = 1.0;
    this.midFilter.gain.value = 0;

    this.highFilter = this.audioContext.createBiquadFilter();
    this.highFilter.type = 'highshelf';
    this.highFilter.frequency.value = 4000; // High frequency cutoff
    this.highFilter.gain.value = 0;

    // 2. Deck Volume Gain
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    // 3. Analyser Node for level visualizers
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 32; // Small size for responsive volume level
    this.analyserData = new Uint8Array(this.analyserNode.frequencyBinCount);

    // Link graph: Source -> Low -> Mid -> High -> Gain -> Analyser
    if (this.sourceNode) {
      this.sourceNode.connect(this.lowFilter);
    }
    this.lowFilter.connect(this.midFilter);
    this.midFilter.connect(this.highFilter);
    this.highFilter.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);

    // Note: AnalyserNode output must be connected to the DjEngine mixer destination
    // Expose final node for external connection
    this.outputNode = this.analyserNode;
  }

  setupListeners() {
    this.audio.addEventListener('timeupdate', () => {
      this.currentTime = this.audio.currentTime;
      this.notifyChange();
    });

    this.audio.addEventListener('durationchange', () => {
      this.duration = this.audio.duration || 0;
      this.notifyChange();
    });

    this.audio.addEventListener('play', () => {
      this.playing = true;
      this.notifyChange();
    });

    this.audio.addEventListener('pause', () => {
      this.playing = false;
      this.notifyChange();
    });

    this.audio.addEventListener('ended', () => {
      this.playing = false;
      this.audio.currentTime = 0;
      this.notifyChange();
      // Track played to completion — whoever wired onTrackEnd (queue
      // auto-advance) decides what comes next. The deck itself just stops.
      if (typeof this.hooks.onTrackEnd === 'function') {
        try { this.hooks.onTrackEnd(this.id); } catch (e) {
          console.warn('AudioDeck onTrackEnd hook failed:', e);
        }
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      // Resume-seek: apply the pending offset (set by loadTrack's startAt)
      // once the duration is known, clamped inside the track so a stale
      // saved position can never park the playhead past the end (which
      // would fire 'ended' immediately and skip the track on resume).
      if (this.pendingSeek > 0) {
        const dur = this.audio.duration;
        const safe = Number.isFinite(dur) && dur > 0
          ? Math.min(this.pendingSeek, Math.max(0, dur - 0.25))
          : this.pendingSeek;
        this.audio.currentTime = Math.max(0, safe);
        this.currentTime = this.audio.currentTime;
        this.pendingSeek = 0;
        this.notifyChange();
      }
    });
  }

  /**
   * Loads a track and extracts its details.
   * Supports local files (by converting to ObjectURL) and standard URLs.
   * @param {Object} track - The track dictionary containing metadata and URL
   * @param {Object} [opts] - Optional: { startAt } resume offset in seconds,
   *   applied on loadedmetadata and clamped inside the track duration.
   */
  async loadTrack(track, opts = {}) {
    if (!track) return;

    // Validate the source FIRST, before any deck state is touched. loadTrack
    // is reachable from drag-and-drop payloads (any page or app can drop
    // text/plain into the window), so a truthy-but-not-Blob `file` or a
    // non-media `url` scheme must never throw or arm a bogus src. On invalid
    // input the deck is left exactly as it was: loadedTrack is NOT replaced
    // and no exception escapes.
    const file = track.file instanceof Blob ? track.file : null;
    const url = typeof track.url === 'string' && isPersistableUrl(track.url) ? track.url : null;
    if (!file && !url) {
      console.warn('AudioDeck: refusing to load track with no valid source (file must be a Blob, url must be http(s)/data/relative).');
      return;
    }

    this.pause();
    this.loadedTrack = track;
    this.bpm = track.bpm || 120;
    this.updateBpm();
    this.currentTime = 0;
    this.cuePoint = 0;
    this.waveformPeaks = [];

    // Resume offset: garbage (NaN/negative/Infinity) collapses to 0 so a
    // poisoned saved position can never park the deck somewhere invalid.
    const startAt = opts && Number.isFinite(opts.startAt) ? Math.max(0, opts.startAt) : 0;
    this.pendingSeek = startAt;

    // Loudness guard: seed per-track attenuation from metadata loudness when
    // the track carries it, otherwise start flat (1.0) until real decoded
    // peaks refine it in decodeWaveform. Reset every load so a hot master
    // can't leak its attenuation onto the next (quiet) track, or vice versa.
    this.trackGain = AudioDeck.calculateTrackGainFromDb(track.loudnessDb);
    this.applyGain();

    // Load track source (both validated above)
    if (file) {
      // Local File object
      const objectUrl = URL.createObjectURL(file);
      this.audio.src = objectUrl;
    } else {
      // Stream URL
      this.audio.src = url;
    }

    this.audio.load();
    this.notifyChange();

    // Decode waveform asynchronously
    this.decodeWaveform(track);
  }

  /**
   * Decode track audio data to compute waveform peaks
   */
  async decodeWaveform(track) {
    this.isDecoding = true;
    this.notifyChange();

    try {
      let arrayBuffer;
      if (track.file) {
        arrayBuffer = await track.file.arrayBuffer();
      } else {
        const response = await fetch(track.url);
        arrayBuffer = await response.arrayBuffer();
      }

      // Decode audio data safely
      this.audioContext.decodeAudioData(arrayBuffer, (audioBuffer) => {
        const channelData = audioBuffer.getChannelData(0);
        const step = Math.ceil(channelData.length / 300); // Downsample to 300 points
        const peaks = [];

        for (let i = 0; i < 300; i++) {
          let max = 0;
          const start = i * step;
          const end = Math.min(start + step, channelData.length);
          for (let j = start; j < end; j++) {
            const val = Math.abs(channelData[j]);
            if (val > max) max = val;
          }
          peaks.push(max);
        }

        this.waveformPeaks = peaks;
        this.isDecoding = false;
        // Real audio data is in hand: refine the loudness guard. Only when
        // the track carried no metadata loudness — metadata takes precedence.
        if (!Number.isFinite(track.loudnessDb)) {
          this.applyLoudnessFromPeaks(peaks);
        } else {
          this.notifyChange();
        }
      }, (e) => {
        console.warn("Waveform decoding failed, using synthetic peaks", e);
        this.generateSyntheticPeaks();
      });
    } catch (e) {
      console.warn("Could not retrieve file data for waveform, generating synthetic", e);
      this.generateSyntheticPeaks();
    }
  }

  generateSyntheticPeaks() {
    // Falls back to a clean mock waveform if network blocks or decoding fails
    const peaks = [];
    for (let i = 0; i < 300; i++) {
      // Create some nice wave-like patterns
      const val = 0.2 + 0.6 * Math.abs(Math.sin(i * 0.05) * Math.cos(i * 0.15)) + 0.1 * Math.random();
      peaks.push(val);
    }
    this.waveformPeaks = peaks;
    this.isDecoding = false;
    this.notifyChange();
  }

  play() {
    if (!this.loadedTrack) return;
    
    // Resume audio context if suspended (browser security block)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.audio.play().catch(err => {
      console.warn("Audio play blocked by browser. User interaction required:", err);
    });
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (this.playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Adjusts the playback speed (tempo)
   * @param {number} pitchVal - Pitch scale percentage (-0.16 to +0.16)
   */
  setPitch(pitchVal) {
    this.pitch = Math.max(-0.16, Math.min(0.16, pitchVal));
    this.audio.playbackRate = 1.0 + this.pitch;
    this.updateBpm();
    this.notifyChange();
  }

  updateBpm() {
    this.currentBpm = Math.round(this.bpm * (1.0 + this.pitch) * 10) / 10;
  }

  /**
   * Sets the pitch range (e.g. ±8%, ±16%)
   * @param {number} range - Pitch scale bound (0.08 or 0.16)
   */
  setPitchRange(range) {
    this.pitchRange = range;
    this.notifyChange();
  }

  /**
   * Set low, mid or high EQ gains in decibels
   * @param {string} band - 'low' | 'mid' | 'high'
   * @param {number} dbValue - gain in db (-12 to +12)
   */
  setEQ(band, dbValue) {
    const val = Math.max(-12, Math.min(12, dbValue));
    if (band === 'low') {
      this.eqLow = val;
      this.lowFilter.gain.value = val;
    } else if (band === 'mid') {
      this.eqMid = val;
      this.midFilter.gain.value = val;
    } else if (band === 'high') {
      this.eqHigh = val;
      this.highFilter.gain.value = val;
    }
    this.notifyChange();
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.applyGain();
    this.notifyChange();
  }

  /**
   * Writes the effective deck gain into the audio graph: the user's volume
   * slider multiplied by the loudness-guard trackGain, so quiet tracks are
   * untouched (x1.0) and hot masters are pulled down toward the reference
   * level. Guard-claused so decks without a built graph (tests, pre-init)
   * never throw.
   */
  applyGain() {
    if (!this.gainNode) return;
    this.gainNode.gain.value = this.volume * this.trackGain;
  }

  /**
   * Pure per-track loudness estimate from decoded waveform peaks (0..1).
   * Only attenuates: tracks at or below the reference loudness return 1.0,
   * louder tracks are scaled down by reference/loudness, clamped to
   * [MIN_TRACK_GAIN, 1]. Garbage input (empty, non-finite) always yields a
   * safe 1.0 instead of poisoning the gain node.
   * @param {number[]} peaks - downsampled 0..1 waveform peaks
   * @returns {number} attenuation multiplier, always finite, in [0.25, 1]
   */
  static calculateTrackGain(peaks) {
    if (!Array.isArray(peaks) || peaks.length === 0) return 1.0;
    let sum = 0;
    let count = 0;
    for (const p of peaks) {
      if (!Number.isFinite(p)) continue;
      sum += Math.min(1, Math.max(0, p));
      count++;
    }
    if (count === 0) return 1.0;
    const loudness = sum / count;
    // epsilon so a track exactly at the reference lands on 1.0, not 0.9999…
    if (loudness <= TARGET_LOUDNESS_PEAK_AVG * (1 + 1e-9)) return 1.0;
    const gain = TARGET_LOUDNESS_PEAK_AVG / loudness;
    return Math.max(MIN_TRACK_GAIN, Math.min(MAX_TRACK_GAIN, gain));
  }

  /**
   * Pure per-track loudness gain from explicit metadata (e.g. integrated
   * LUFS carried on the track record). Tracks hotter than the reference
   * level are attenuated; tracks at or below it pass through at 1.0.
   * @param {number} loudnessDb - integrated loudness in dB (LUFS-ish)
   * @returns {number} attenuation multiplier, always finite, in [0.25, 1]
   */
  static calculateTrackGainFromDb(loudnessDb) {
    if (!Number.isFinite(loudnessDb)) return 1.0;
    const gain = Math.pow(10, (TARGET_LOUDNESS_DB - loudnessDb) / 20);
    return Math.max(MIN_TRACK_GAIN, Math.min(MAX_TRACK_GAIN, gain));
  }

  /**
   * Refines the loudness guard from real decoded audio peaks. Synthetic
   * fallback peaks never reach here — fake data must not drive real gain.
   * @param {number[]} peaks - downsampled 0..1 waveform peaks from decodeWaveform
   */
  applyLoudnessFromPeaks(peaks) {
    this.trackGain = AudioDeck.calculateTrackGain(peaks);
    this.applyGain();
    this.notifyChange();
  }

  setCue() {
    this.cuePoint = this.audio.currentTime;
    this.notifyChange();
  }

  playCue() {
    if (!this.loadedTrack) return;
    this.audio.currentTime = this.cuePoint;
    this.play();
  }

  syncTo(targetBpm) {
    if (!this.bpm) return;
    // Calculate required pitch to match target BPM
    const targetPitch = (targetBpm / this.bpm) - 1.0;
    this.setPitch(targetPitch);
  }

  /**
   * Scrubs the audio position (used during scratch/platters interaction)
   * @param {number} percent - position percentage (0 to 1)
   */
  scrub(percent) {
    if (!this.duration) return;
    this.audio.currentTime = percent * this.duration;
    this.currentTime = this.audio.currentTime;
    this.notifyChange();
  }

  /**
   * Reads current decibel level for LED rendering.
   * Returns a value between 0 (silent) and 1 (max signal)
   */
  getVolumeLevel() {
    if (!this.playing || !this.loadedTrack) return 0;
    this.analyserNode.getByteFrequencyData(this.analyserData);
    
    // Average amplitude of active bins
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sum += this.analyserData[i];
    }
    const average = sum / this.analyserData.length;
    return average / 255; // Normalize to 0..1
  }

  notifyChange() {
    this.onChange({
      id: this.id,
      playing: this.playing,
      loadedTrack: this.loadedTrack,
      currentTime: this.currentTime,
      duration: this.duration,
      pitch: this.pitch,
      bpm: this.bpm,
      currentBpm: this.currentBpm,
      pitchRange: this.pitchRange,
      volume: this.volume,
      eqLow: this.eqLow,
      eqMid: this.eqMid,
      eqHigh: this.eqHigh,
      cuePoint: this.cuePoint,
      isDecoding: this.isDecoding,
      waveformPeaks: this.waveformPeaks,
      trackGain: this.trackGain
    });
  }

  destroy() {
    this.pause();
    this.audio.src = '';
    try {
      this.lowFilter.disconnect();
      this.midFilter.disconnect();
      this.highFilter.disconnect();
      this.gainNode.disconnect();
      this.analyserNode.disconnect();
      if (this.sourceNode) this.sourceNode.disconnect();
    } catch (e) {
      console.warn("Error disconnecting AudioDeck nodes:", e);
    }
  }
}
