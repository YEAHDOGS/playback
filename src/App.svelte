<script>
  import { onMount } from 'svelte';
  import { locale, t } from './lib/i18n.js';
  import DjEngine from './lib/audio/DjEngine.js';
  import Platter from './lib/components/Platter.svelte';
  import Mixer from './lib/components/Mixer.svelte';
  import Waveform from './lib/components/Waveform.svelte';
  import TrackList from './lib/components/TrackList.svelte';
  import { Settings, X, Globe, Moon, Sun, Cable, Play, Music } from 'lucide-svelte';

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
  
  // Mobile tab state: 'deck1' | 'mixer' | 'deck2' | 'library'
  let mobileTab = $state('deck1');

  onMount(() => {
    // Instantiate the engine, state updates are bound to engineState
    engine = new DjEngine((state) => {
      engineState = state;
    });

    return () => {
      if (engine) engine.destroy();
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

  // Handle drops onto Deck containers
  function handleDrop(e, deckId) {
    e.preventDefault();
    if (!engine) return;

    const data = e.dataTransfer.getData('text/plain');
    if (data) {
      // Dragged from TrackList table
      const track = JSON.parse(data);
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
              onLoadTrack={(ignoredId, track) => engine.deck1.loadTrack(track)}
            />
          </div>
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
              onLoadTrack={(ignoredId, track) => engine.deck2.loadTrack(track)}
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
