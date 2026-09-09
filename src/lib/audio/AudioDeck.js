/**
 * AudioDeck class represents one of the two DJ decks.
 * Decouples audio playback, EQ, gain nodes, and analysers from presentation.
 */
export default class AudioDeck {
  /**
   * @param {string} id - Deck ID ('deck1' or 'deck2')
   * @param {AudioContext} audioContext - The shared audio context
   * @param {Function} onChange - Callback triggered when state updates
   */
  constructor(id, audioContext, onChange) {
    this.id = id;
    this.audioContext = audioContext;
    this.onChange = onChange || (() => {});

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
    this.loadError = null; // MEDIA_ERR_* code object from the last failed load, if any
    this.objectUrl = null; // blob URL we created for a local file (must be revoked)
    this.decodeToken = 0; // generation counter invalidating stale async waveform decodes
    this.destroyed = false; // lifecycle seal: once destroyed, async work goes silent

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
    });

    this.audio.addEventListener('error', () => {
      // The media element failed to load or decode its source (404, CORS,
      // bad codec). Publish the error so the UI can show a broken-track
      // state instead of leaving a silently dead deck.
      const mediaError = this.audio.error;
      this.loadError = { code: mediaError ? mediaError.code : 0 };
      this.playing = false;
      this.notifyChange();
    });
  }

  /**
   * Loads a track and extracts its details.
   * Supports local files (by converting to ObjectURL) and standard URLs.
   * @param {Object} track - The track dictionary containing metadata and URL
   */
  async loadTrack(track) {
    if (!track) return;

    this.pause();
    this.loadedTrack = track;
    this.bpm = track.bpm || 120;
    this.updateBpm();
    this.currentTime = 0;
    this.cuePoint = 0;
    this.waveformPeaks = [];
    this.loadError = null; // a new load clears the previous track's error state

    // Revoke any previously created blob URL before loading a new source,
    // otherwise every track swap leaks one object URL (and its audio bytes).
    this.revokeObjectUrl();

    // Load track source
    if (track.file) {
      // Local File object
      const objectUrl = URL.createObjectURL(track.file);
      this.objectUrl = objectUrl;
      this.audio.src = objectUrl;
    } else {
      // Stream URL
      this.audio.src = track.url;
    }

    this.audio.load();
    this.notifyChange();

    // Decode waveform asynchronously, stamped with this load's generation token
    // so a slow decode from a previous track can never overwrite the new one.
    const decodeToken = ++this.decodeToken;
    this.decodeWaveform(track, decodeToken);
  }

  /**
   * Decode track audio data to compute waveform peaks
   * @param {Object} track - The track to decode
   * @param {number} token - Generation token; results are ignored if the deck
   *   has started a newer decode since (prevents stale-track waveform races)
   */
  async decodeWaveform(track, token) {
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
        // Stale decode (track swapped while decoding): ignore, the newer
        // load owns the waveform state.
        if (token !== this.decodeToken) return;
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
        this.notifyChange();
      }, (e) => {
        if (token !== this.decodeToken) return;
        console.warn("Waveform decoding failed, using synthetic peaks", e);
        this.generateSyntheticPeaks();
      });
    } catch (e) {
      if (token !== this.decodeToken) return;
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
    this.gainNode.gain.value = this.volume;
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
    // Clamp: out-of-range platter input must never seek past the track bounds.
    const clamped = Math.max(0, Math.min(1, percent));
    this.audio.currentTime = clamped * this.duration;
    this.currentTime = this.audio.currentTime;
    this.notifyChange();
  }

  /**
   * Moves the playback position by a relative amount, clamped to the
   * track bounds [0, duration] so seeks can never land out of range.
   * @param {number} seconds - Positive or negative offset in seconds
   */
  seekBy(seconds) {
    if (!this.duration) return;
    const next = this.audio.currentTime + seconds;
    this.audio.currentTime = Math.max(0, Math.min(this.duration, next));
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

  /**
   * Releases the blob object URL created by the last file-based loadTrack(),
   * if any. Safe to call repeatedly or when nothing is tracked.
   */
  revokeObjectUrl() {
    if (!this.objectUrl) return;
    try {
      URL.revokeObjectURL(this.objectUrl);
    } catch (e) {
      console.warn("Could not revoke object URL:", e);
    } finally {
      this.objectUrl = null;
    }
  }

  notifyChange() {
    // A destroyed deck publishes nothing: late media-element events and
    // in-flight async decodes must not reach listeners after teardown.
    if (this.destroyed) return;
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
      loadError: this.loadError
    });
  }

  destroy() {
    // Seal the deck first: any waveform decode still in flight is orphaned
    // (decodeToken bump invalidates it), and no further state changes or
    // notifications escape to listeners after this point.
    this.destroyed = true;
    this.decodeToken++;
    this.isDecoding = false;

    this.pause();
    this.audio.src = '';
    this.revokeObjectUrl();
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
