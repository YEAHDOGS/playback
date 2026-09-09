<script>
  import { onMount } from 'svelte';
  import { locale, t } from './lib/i18n.js';
  import DjEngine from './lib/audio/DjEngine.js';
  import MidiBridge from './lib/audio/MidiBridge.js';
  import { attachKeyboardShortcuts } from './lib/keyboard.js';
  import { PlaybackQueue } from './lib/queue/PlaybackQueue.js';
  import { DEMO_TRACKS } from './lib/catalog.js';
  import Platter from './lib/components/Platter.svelte';
  import Mixer from './lib/components/Mixer.svelte';
  import Waveform from './lib/components/Waveform.svelte';
  import TrackList from './lib/components/TrackList.svelte';
  import QueuePanel from './lib/components/QueuePanel.svelte';
  import { Settings, X, Globe, Moon, Sun, Play, Music } from 'lucide-svelte';

  let engine = $state(null);
  let engineState = $state({
    initialized: false,
    masterVolume: 0.8,
    crossfader: 0.0,
    deck1: null,
    deck2: null
  });

  // UI state variables
  let showSettings = $state(false);
  let activeTheme = $state('Night'); // 'Night' or 'Daytime'

  // MIDI controller bridge state
  let midiBridge = $state(null);
  let midiState = $state({ status: 'idle', supported: false, devices: [] });
  
  // Mobile tab state: 'deck1' | 'mixer' | 'deck2' | 'library'
  let mobileTab = $state('deck1');

  // Persistent session queue: survives reloads, restored against the
  // catalog on boot. Local uploads are pruned (File refs can't persist);
  // the prune count is surfaced once in the queue panel.
  let queue = $state(null);
  let queueDropped = $state(0);

  // Local uploads reported up by each library column, keyed by source, so
  // queue snapshots can be resolved back to full track objects (incl. the
  // live File ref) while the session is alive.
  let libraryExtras = $state({});
  let liveCatalog = $derived([
    ...DEMO_TRACKS,
    ...Object.values(libraryExtras).flat()
  ]);

  onMount(() => {
    // Restore the saved queue before the audio engine exists — the queue is
    // pure data + localStorage and never touches audio. Playback stays
    // paused until a gesture (browsers block autoplay regardless).
    queue = new PlaybackQueue();
    const restored = queue.restore(DEMO_TRACKS);
    queueDropped = restored.dropped;

    // Instantiate the engine, state updates are bound to engineState
    engine = new DjEngine((state) => {
      engineState = state;
    }, { onTrackEnd: handleDeckTrackEnd });

    // Keyboard transport shortcuts (Space, X, C/V, S, arrows)
    const detachKeys = attachKeyboardShortcuts(engine);

    return () => {
      detachKeys();
      if (engine) engine.destroy();
      if (midiBridge) midiBridge.destroy();
    };
  });

  function startEngine() {
    if (engine) {
      engine.init();
    }
  }

  function toggleTheme(themeName) {
    activeTheme = themeName;
    if (themeName === 'Daytime') {
      document.body.classList.add('theme-daytime');
    } else {
      document.body.classList.remove('theme-daytime');
    }
  }

  function selectLanguage(lang) {
    $locale = lang;
  }

  // Connect a hardware MIDI DJ controller (Web MIDI, user-gesture only)
  async function connectMidi() {
    if (!engine || midiBridge) return;
    midiBridge = new MidiBridge(engine, {
      onChange: (state) => { midiState = state; },
      onUnhandled: (msg) => {
        console.debug('[MIDI] unmapped message — add it to MidiBridge map:', msg);
      }
    });
    await midiBridge.connect();
  }

  // Load a track into the requested deck ('deck1' | 'deck2')
  function loadTrackInto(deckId, track) {
    if (!engine || !track) return;
    const deck = deckId === 'deck2' ? engine.deck2 : engine.deck1;
    deck.loadTrack(track);
  }

  // ── Session queue wiring ──────────────────────────────────────────────

  function enqueueTrack(track) {
    if (queue) queue.add(track);
  }

  function registerLibraryTracks(source, tracks) {
    // Keep only session-live uploads (demo catalog ids are canonical in
    // lib/catalog.js); snapshot resolution needs the live File refs.
    libraryExtras[source] = (tracks || []).filter(
      (t) => t && String(t.id).startsWith('local-')
    );
  }

  // Resolve a persisted queue snapshot back to the fullest track object we
  // have (demo catalog first, then live uploads). Falls back to the snapshot
  // itself, which carries url/title/artist for streamable tracks.
  function resolveQueueTrack(snap) {
    if (!snap) return null;
    return liveCatalog.find((t) => String(t.id) === String(snap.id)) || snap;
  }

  // Play queue entry i on deck 1. Replaying the restored current index
  // resumes at the saved position; picking another entry starts at 0.
  function playQueueAt(i) {
    if (!queue || !engine || !engine.deck1) return;
    const resumeAt = i === queue.index ? queue.position : 0;
    if (!queue.setIndex(i)) return;
    engine.deck1.loadTrack(resolveQueueTrack(queue.current()), { startAt: resumeAt });
    engine.deck1.play();
  }

  function queueStep(dir) {
    if (!queue || !engine || !engine.deck1) return;
    const track = dir > 0 ? queue.next() : queue.prev();
    if (!track) return;
    engine.deck1.loadTrack(resolveQueueTrack(track));
    engine.deck1.play();
  }

  function removeQueueAt(i) {
    if (queue) queue.removeAt(i);
  }

  function clearQueue() {
    if (queue) queue.clear();
  }

  // A deck's track played to completion: only auto-advance when the deck was
  // playing FROM the queue (deck-loaded tracks loaded by hand are the DJ's
  // business — the queue never hijacks a manually loaded deck).
  function handleDeckTrackEnd(deckId) {
    if (!queue || !engine) return;
    const deck = deckId === 'deck2' ? engine.deck2 : engine.deck1;
    const current = queue.current();
    if (!deck || !current || !deck.loadedTrack) return;
    if (String(deck.loadedTrack.id) !== current.id) return;
    const nextTrack = queue.next();
    if (!nextTrack) return;
    deck.loadTrack(resolveQueueTrack(nextTrack));
    deck.play();
  }

  // Persist the deck-1 playhead into the queue while it plays the queue's
  // current track: throttled during playback, flushed on pause. This is
  // what makes "reopens at the saved position" true across reloads.
  let lastQueueSaveAt = 0;
  let deck1WasPlaying = false;
  $effect(() => {
    const d1 = engineState.deck1;
    const q = queue;
    const playing = d1?.playing === true;
    const matches =
      !!q && !!d1?.loadedTrack && !!q.current() &&
      String(d1.loadedTrack.id) === q.current().id;
    if (matches) {
      const now = Date.now();
      if (playing && now - lastQueueSaveAt > 5000) {
        lastQueueSaveAt = now;
        q.setPosition(d1.currentTime || 0);
      }
      if (!playing && deck1WasPlaying) {
        lastQueueSaveAt = now;
        q.setPosition(d1.currentTime || 0);
      }
    }
    deck1WasPlaying = playing;
  });

  // Handle drops onto Deck containers
  function handleDrop(e, deckId) {
    e.preventDefault();
    if (!engine) return;

    const data = e.dataTransfer.getData('text/plain');
    if (data) {
      // Dragged from TrackList table — or from ANY other page/app, since
      // text/plain drop payloads are not origin-restricted. Parse defensively
      // and require a track-shaped object before handing it to a deck.
      let track = null;
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            && (typeof parsed.id === 'string' || typeof parsed.id === 'number')) {
          track = parsed;
        }
      } catch {
        track = null; // malformed JSON — ignore the drop
      }
      if (!track) return;
      if (deckId === 'deck1') {
        engine.deck1.loadTrack(track);
      } else {
        engine.deck2.loadTrack(track);
      }
    } else if (e.dataTransfer.files.length > 0) {
      // Dragged local file from OS
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav')) {
        const localTrack = {
          id: `local-${Date.now()}`,
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: 'Local File',
          file: file,
          bpm: 120,
          duration: '--:--'
        };
        if (deckId === 'deck1') {
          engine.deck1.loadTrack(localTrack);
        } else {
          engine.deck2.loadTrack(localTrack);
        }
      }
    }
  }
</script>

<main class="w-full h-full min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--color-text)] transition-colors duration-250">
  
  <!-- Header Bar -->
  <header class="h-14 border-b border-[var(--border-color)] px-4 flex justify-between items-center bg-[var(--bg-card)] shrink-0 z-20 transition-colors">
    <div class="flex items-center gap-1.5 select-none">
      <span class="font-display font-black text-lg tracking-wider text-glow text-[var(--color-neon-red)]">
        {$t('app.title')}
      </span>
      <span class="text-[8px] font-display font-medium bg-[var(--bg-input)] text-[var(--color-text-muted)] border border-[var(--border-color)] px-1 rounded uppercase tracking-widest scale-90">
        {$t('app.version')}
      </span>
    </div>

    <!-- Center master state decoration -->
    <div class="hidden sm:flex items-center gap-4 text-[10px] font-mono text-[var(--color-text-muted)]">
      <div class="flex items-center gap-1.5">
        <div class="w-2 h-2 rounded-full {engineState.initialized ? 'bg-emerald-500' : 'bg-red-500'}"></div>
        <span>AUDIO: {engineState.initialized ? 'ACTIVE' : 'READY'}</span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <!-- by DOGS branding -->
      <a 
        href="https://wearedogs.com" 
        target="_blank" 
        rel="noreferrer" 
        class="text-[9px] font-display font-extrabold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] transition-colors scale-90"
      >
        {$t('app.by')}
      </a>

      <!-- Settings button toggle -->
      <button 
        class="p-1.5 rounded-lg border border-[var(--border-color)] hover:border-[var(--color-neon-red)] text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] bg-[var(--bg-input)] transition-all cursor-pointer"
        onclick={() => showSettings = !showSettings}
      >
        <Settings class="w-4 h-4" />
      </button>
    </div>
  </header>

  <!-- Main DJ Space -->
  <div class="flex-1 w-full relative flex flex-col overflow-hidden p-3 gap-3">
    
    <!-- Activation Overlay (No Web Audio before interaction) -->
    {#if !engineState.initialized}
      <div class="absolute inset-0 z-40 bg-[var(--bg-app)] flex flex-col items-center justify-center p-6 text-center transition-colors">
        <div class="relative w-44 h-44 flex items-center justify-center mb-6">
          <!-- Spinning Vinyl record animation -->
          <div class="absolute inset-0 rounded-full border-[8px] border-black bg-[#0d0d12] shadow-2xl flex items-center justify-center jog-platter-rotating" style="animation-duration: 6s;">
            <div class="w-[85%] h-[85%] rounded-full border border-slate-800 border-dashed opacity-40"></div>
            <div class="w-16 h-16 rounded-full bg-[#15151c] border-2 border-slate-700 flex items-center justify-center">
              <div class="w-4 h-4 rounded-full bg-slate-900 border border-slate-800"></div>
            </div>
          </div>
          <Music class="w-10 h-10 text-[var(--color-neon-red)] text-glow z-10 animate-pulse" />
        </div>

        <h2 class="font-display font-black text-2xl tracking-widest uppercase mb-2 text-[var(--color-text)]">
          {$t('app.title')}
        </h2>
        <p class="text-xs text-[var(--color-text-muted)] max-w-md mb-6 leading-relaxed">
          Unlock low-latency pitch shifting, 3-band EQs, rotating platters, and custom local file mixing by activating the Web Audio context.
        </p>
        
        <button 
          class="px-8 py-3 rounded-lg bg-[var(--color-neon-red)] text-white hover:bg-[var(--color-neon-red-hover)] border border-[var(--color-neon-red)] font-display font-bold uppercase tracking-wider text-xs shadow-[0_0_15px_var(--color-neon-red-glow)] active:scale-95 transition-all cursor-pointer flex items-center gap-2"
          onclick={startEngine}
        >
          <Play class="w-4 h-4 fill-white stroke-none" />
          Activate Playback Console
        </button>
      </div>
    {/if}

    <!-- ───── Main Interactive Area ───── -->
    {#if engineState.initialized}
      <!-- 1. Mobile Portrait view tabs (Deck 1 / Mixer / Deck 2) -->
      <div class="flex md:hidden border border-[var(--border-color)] bg-[var(--bg-card)] rounded-lg p-1 shrink-0 z-10">
        <button 
          class="flex-1 py-1 text-[10px] font-display uppercase tracking-wider font-bold rounded {mobileTab === 'deck1' ? 'bg-[var(--color-neon-red-dim)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}"
          onclick={() => mobileTab = 'deck1'}
        >
          Deck 1
        </button>
        <button 
          class="flex-1 py-1 text-[10px] font-display uppercase tracking-wider font-bold rounded {mobileTab === 'mixer' ? 'bg-[var(--color-neon-red-dim)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}"
          onclick={() => mobileTab = 'mixer'}
        >
          Mixer
        </button>
        <button 
          class="flex-1 py-1 text-[10px] font-display uppercase tracking-wider font-bold rounded {mobileTab === 'deck2' ? 'bg-[var(--color-neon-red-dim)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}"
          onclick={() => mobileTab = 'deck2'}
        >
          Deck 2
        </button>
      </div>

      <!-- 2. Decks & Mixer workspace (Deck A: 1/3, Mixer: 1/3, Deck B: 1/3) -->
      <div class="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-hidden min-h-0 w-full pb-2">
        
        <!-- Column 1: Deck A (Drop zone) -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div 
          class="flex flex-col gap-3 overflow-hidden h-full"
          class:hidden={mobileTab !== 'deck1' && mobileTab !== 'mixer'}
          class:md:flex={true}
          ondragover={e => e.preventDefault()}
          ondrop={e => handleDrop(e, 'deck1')}
        >
          <Platter 
            deckState={engineState.deck1 || {}} 
            deck={engine.deck1}
            {engine}
            syncSourceId="deck2"
            syncSourceBpm={engineState.deck2?.currentBpm}
          />
          <Waveform 
            peaks={engineState.deck1?.waveformPeaks}
            currentTime={engineState.deck1?.currentTime}
            duration={engineState.deck1?.duration}
            isDecoding={engineState.deck1?.isDecoding}
            onScrub={(pct) => engine.deck1.scrub(pct)}
          />
          <div class="flex-1 min-h-0">
            <TrackList 
              defaultDeck="deck1"
              onLoadTrack={(deckId, track) => loadTrackInto(deckId, track)}
              onEnqueue={(track) => enqueueTrack(track)}
              onTracksChange={(tracks) => registerLibraryTracks('deck1', tracks)}
            />
          </div>
          {#if queue}
            <div class="shrink-0">
              <QueuePanel
                {queue}
                droppedCount={queueDropped}
                onPlayAt={(i) => playQueueAt(i)}
                onRemoveAt={(i) => removeQueueAt(i)}
                onClear={clearQueue}
                onPrev={() => queueStep(-1)}
                onNext={() => queueStep(1)}
              />
            </div>
          {/if}
        </div>

        <!-- Column 2: Central Mixer -->
        <div 
          class="h-full overflow-hidden"
          class:hidden={mobileTab !== 'mixer'}
          class:md:block={true}
        >
          <Mixer 
            {engine}
            deck1={engine.deck1}
            deck2={engine.deck2}
            deck1State={engineState.deck1 || {}}
            deck2State={engineState.deck2 || {}}
            masterVolume={engineState.masterVolume}
            crossfader={engineState.crossfader}
          />
        </div>

        <!-- Column 3: Deck B (Drop zone) -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div 
          class="flex flex-col gap-3 overflow-hidden h-full"
          class:hidden={mobileTab !== 'deck2' && mobileTab !== 'mixer'}
          class:md:flex={true}
          ondragover={e => e.preventDefault()}
          ondrop={e => handleDrop(e, 'deck2')}
        >
          <Platter 
            deckState={engineState.deck2 || {}} 
            deck={engine.deck2}
            {engine}
            syncSourceId="deck1"
            syncSourceBpm={engineState.deck1?.currentBpm}
          />
          <Waveform 
            peaks={engineState.deck2?.waveformPeaks}
            currentTime={engineState.deck2?.currentTime}
            duration={engineState.deck2?.duration}
            isDecoding={engineState.deck2?.isDecoding}
            onScrub={(pct) => engine.deck2.scrub(pct)}
          />
          <div class="flex-1 min-h-0">
            <TrackList 
              defaultDeck="deck2"
              onLoadTrack={(deckId, track) => loadTrackInto(deckId, track)}
              onEnqueue={(track) => enqueueTrack(track)}
              onTracksChange={(tracks) => registerLibraryTracks('deck2', tracks)}
            />
          </div>
        </div>

      </div>
    {/if}

  </div>

  <!-- Settings sliding drawer panel -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div 
    class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end transition-opacity duration-200"
    class:opacity-100={showSettings}
    class:pointer-events-auto={showSettings}
    class:opacity-0={!showSettings}
    class:pointer-events-none={!showSettings}
    onclick={() => showSettings = false}
  >
    <!-- Drawer content -->
    <div 
      class="w-80 h-full bg-[var(--bg-card)] border-l border-[var(--border-color)] p-6 flex flex-col justify-between shadow-2xl transition-transform duration-200"
      class:translate-x-0={showSettings}
      class:translate-x-full={!showSettings}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex flex-col gap-6">
        <!-- Close button & Title -->
        <div class="flex justify-between items-center border-b border-[var(--border-color)] pb-3">
          <h3 class="font-display font-extrabold uppercase tracking-widest text-sm text-[var(--color-text)]">
            {$t('settings.header')}
          </h3>
          <button 
            class="p-1 rounded-lg border border-[var(--border-color)] text-[var(--color-text-muted)] hover:border-[#ff2a3b] hover:text-[#ff2a3b] bg-[var(--bg-input)] cursor-pointer"
            onclick={() => showSettings = false}
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Theme selector -->
        <div class="flex flex-col gap-2">
          <span class="block text-[10px] font-display uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
            {$t('settings.theme')}
          </span>
          <div class="grid grid-cols-2 gap-2 bg-[var(--bg-input)] p-1 rounded-lg border border-[var(--border-color)]">
            <button 
              class="py-1 text-xs font-semibold rounded flex items-center justify-center gap-1.5 cursor-pointer {activeTheme === 'Night' ? 'bg-[var(--bg-card)] text-[var(--color-neon-red)]' : 'text-[var(--color-text-muted)]'}"
              onclick={() => toggleTheme('Night')}
            >
              <Moon class="w-3.5 h-3.5" />
              <span>Night</span>
            </button>
            <button 
              class="py-1 text-xs font-semibold rounded flex items-center justify-center gap-1.5 cursor-pointer {activeTheme === 'Daytime' ? 'bg-[var(--bg-card)] text-[var(--color-neon-red)]' : 'text-[var(--color-text-muted)]'}"
              onclick={() => toggleTheme('Daytime')}
            >
              <Sun class="w-3.5 h-3.5" />
              <span>Daytime</span>
            </button>
          </div>
        </div>

        <!-- Language selector -->
        <div class="flex flex-col gap-2">
          <label for="language-select" class="text-[10px] font-display uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
            {$t('settings.language')}
          </label>
          <div class="relative">
            <Globe class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
            <select
              id="language-select"
              value={$locale}
              onchange={(e) => selectLanguage(e.target.value)}
              class="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-neon-red)] cursor-pointer appearance-none"
            >
              <option value="en">English (US)</option>
              <option value="es">Español (ES)</option>
            </select>
          </div>
        </div>

        <!-- MIDI controller status -->
        <div class="flex flex-col gap-2">
          <span class="block text-[10px] font-display uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
            {$t('midi.title')}
          </span>
          <div class="flex items-center gap-2 text-xs text-[var(--color-text)]">
            <div class="w-2 h-2 rounded-full {midiState.status === 'connected' && midiState.devices.length > 0 ? 'bg-emerald-500' : midiState.status === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}"></div>
            <span class="font-medium">
              {#if !midiState.supported && midiState.status !== 'idle'}
                {$t('midi.unsupported')}
              {:else if midiState.status === 'connected' && midiState.devices.length > 0}
                {$t('midi.connected')}: {midiState.devices.map(d => d.name).join(', ')}
              {:else if midiState.status === 'connecting'}
                {$t('midi.connecting')}
              {:else}
                {$t('midi.no_device')}
              {/if}
            </span>
          </div>
          {#if !midiBridge}
            <button
              class="py-1.5 px-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] text-[var(--color-text-muted)] text-xs font-semibold transition-colors cursor-pointer"
              onclick={connectMidi}
            >
              {$t('midi.connect')}
            </button>
          {/if}
        </div>

      </div>

      <!-- Close Action -->
      <button 
        class="w-full py-2 bg-[var(--bg-input)] hover:bg-[var(--border-color)] text-[var(--color-text)] font-semibold text-xs border border-[var(--border-color)] rounded-lg transition-colors cursor-pointer"
        onclick={() => showSettings = false}
      >
        {$t('settings.close')}
      </button>
    </div>
  </div>

</main>
