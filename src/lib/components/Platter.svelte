<script>
  import { t } from '../i18n.js';
  import { Play, Pause, RotateCcw, Music } from 'lucide-svelte';

  // Svelte 5 props
  let { 
    deckState = {}, 
    deck = null 
  } = $props();

  let isScratching = $state(false);
  let startAngle = 0;
  let rotationAngle = $state(0);
  let timeDisplayMode = $state('elapsed'); // 'elapsed' or 'remaining'
  let hotCues = $state([null, null, null, null]);

  // Format seconds to MM:SS.CC (centiseconds)
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return '00:00.00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hundredths = Math.floor((seconds % 1) * 100);
    
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(mins)}:${pad(secs)}.${pad(hundredths)}`;
  }

  let formattedTime = $derived.by(() => {
    if (timeDisplayMode === 'elapsed') {
      return formatTime(deckState.currentTime || 0);
    } else {
      const remaining = (deckState.duration || 0) - (deckState.currentTime || 0);
      return '-' + formatTime(Math.max(0, remaining));
    }
  });

  function toggleTimeMode() {
    timeDisplayMode = timeDisplayMode === 'elapsed' ? 'remaining' : 'elapsed';
  }

  // Handle platter drag scratching
  function handlePlatterMouseDown(e) {
    if (!deckState.loadedTrack) return;
    isScratching = true;
    deck.pause();

    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    window.addEventListener('mousemove', handlePlatterMouseMove);
    window.addEventListener('mouseup', handlePlatterMouseUp);
  }

  function handlePlatterMouseMove(e) {
    if (!isScratching) return;
    
    // Find the angle of pointer relative to center
    const platterEl = document.getElementById(`platter-circle-${deckState.id}`);
    if (!platterEl) return;

    const rect = platterEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const angleDelta = currentAngle - startAngle;
    startAngle = currentAngle;

    // Rotate jog visual
    rotationAngle = (rotationAngle + angleDelta * (180 / Math.PI)) % 360;

    // Map rotation delta to audio scrubbing
    // One full spin (360 degrees) = 1.8 seconds of audio
    const secondsDelta = (angleDelta / (2 * Math.PI)) * 1.8;
    let newTime = (deckState.currentTime || 0) + secondsDelta;
    newTime = Math.max(0, Math.min(deckState.duration || 0, newTime));
    
    // Direct low-latency scrub
    deck.audio.currentTime = newTime;
  }

  function handlePlatterMouseUp() {
    isScratching = false;
    window.removeEventListener('mousemove', handlePlatterMouseMove);
    window.removeEventListener('mouseup', handlePlatterMouseUp);

    // If deck was playing previously, resume
    if (deckState.playing) {
      deck.play();
    }
  }

  // Touch support for mobile scratching
  function handlePlatterTouchStart(e) {
    if (!deckState.loadedTrack || e.touches.length !== 1) return;
    isScratching = true;
    deck.pause();

    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    startAngle = Math.atan2(e.touches[0].clientY - centerY, e.touches[0].clientX - centerX);

    window.addEventListener('touchmove', handlePlatterTouchMove, { passive: false });
    window.addEventListener('touchend', handlePlatterTouchEnd);
  }

  function handlePlatterTouchMove(e) {
    if (!isScratching || e.touches.length !== 1) return;
    e.preventDefault();

    const platterEl = document.getElementById(`platter-circle-${deckState.id}`);
    if (!platterEl) return;

    const rect = platterEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const currentAngle = Math.atan2(e.touches[0].clientY - centerY, e.touches[0].clientX - centerX);
    const angleDelta = currentAngle - startAngle;
    startAngle = currentAngle;

    rotationAngle = (rotationAngle + angleDelta * (180 / Math.PI)) % 360;

    const secondsDelta = (angleDelta / (2 * Math.PI)) * 1.8;
    let newTime = (deckState.currentTime || 0) + secondsDelta;
    newTime = Math.max(0, Math.min(deckState.duration || 0, newTime));
    deck.audio.currentTime = newTime;
  }

  function handlePlatterTouchEnd() {
    isScratching = false;
    window.removeEventListener('touchmove', handlePlatterTouchMove);
    window.removeEventListener('touchend', handlePlatterTouchEnd);

    if (deckState.playing) {
      deck.play();
    }
  }

  // Pitch adjustment fader
  function handlePitchChange(e) {
    const pitchVal = parseFloat(e.target.value);
    deck.setPitch(pitchVal);
  }

  // Hot Cue trigger
  function handleHotCue(index) {
    if (!deckState.loadedTrack) return;

    if (hotCues[index] === null) {
      // Set cue point at current location
      const cues = [...hotCues];
      cues[index] = deckState.currentTime;
      hotCues = cues;
    } else {
      // Jump to stored cue point
      deck.audio.currentTime = hotCues[index];
      if (!deckState.playing) {
        deck.play();
      }
    }
  }

  function clearHotCue(index, e) {
    e.stopPropagation();
    const cues = [...hotCues];
    cues[index] = null;
    hotCues = cues;
  }

  // Continuously rotate jog indicator while playing
  let animationFrame;
  $effect(() => {
    if (deckState.playing && !isScratching) {
      const updateRotation = () => {
        // Rotate at 33.3 RPM (Revolutions Per Minute)
        // 33.3 revs / 60 seconds = 0.555 revs/sec = 200 degrees/sec
        // Speed scaling based on playback pitch rate
        const speedMultiplier = 1.0 + (deckState.pitch || 0);
        rotationAngle = (rotationAngle + (200 / 60) * speedMultiplier) % 360;
        animationFrame = requestAnimationFrame(updateRotation);
      };
      animationFrame = requestAnimationFrame(updateRotation);
      return () => cancelAnimationFrame(animationFrame);
    }
  });
</script>

<div class="panel-border bg-[var(--bg-card)] rounded-xl p-4 flex flex-col gap-4 select-none relative overflow-hidden transition-all shadow-md w-full">
  <!-- Top metadata row -->
  <div class="flex justify-between items-start border-b border-[var(--border-color)] pb-2 h-12">
    <div class="flex flex-col min-w-0 max-w-[65%]">
      {#if deckState.loadedTrack}
        <span class="text-xs font-bold truncate text-[var(--color-text)] flex items-center gap-1">
          <Music class="w-3 h-3 text-[var(--color-neon-red)] shrink-0" />
          {deckState.loadedTrack.title}
        </span>
        <span class="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">
          {deckState.loadedTrack.artist}
        </span>
      {:else}
        <span class="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider">
          {$t('deck.empty')}
        </span>
      {/if}
    </div>

    <!-- Digital time display -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      class="flex flex-col items-end cursor-pointer select-none font-display font-bold text-lg text-glow tracking-widest text-[var(--color-neon-red)] leading-none"
      onclick={toggleTimeMode}
    >
      <span>{formattedTime}</span>
      <span class="text-[8px] text-[var(--color-text-muted)] tracking-wider mt-1 uppercase scale-90 origin-right">
        {timeDisplayMode === 'elapsed' ? $t('deck.elapsed') : $t('deck.remaining')}
      </span>
    </div>
  </div>

  <!-- Symmetrical Platter and Pitch Slider Row -->
  <div class="flex justify-between items-center gap-4 py-2">
    
    <!-- Pitch Slider & BPM Stats Column (Symmetric: order-1 for Deck A, order-3 for Deck B) -->
    <div class="flex flex-col gap-2 shrink-0 select-none {deckState.id === 'deck1' ? 'order-1 items-start' : 'order-3 items-end'}">
      <div class="flex flex-col leading-none {deckState.id === 'deck1' ? 'items-start' : 'items-end'}">
        <span class="text-[20px] font-display font-black text-[var(--color-text)] tracking-wider">
          {deckState.currentBpm || 120}
        </span>
        <span class="text-[8px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-0.5">
          {$t('controls.bpm')}
        </span>
      </div>
      
      <div class="relative h-28 flex justify-center w-6">
        <!-- Vertical range input styled as fader track -->
        <input 
          type="range" 
          min="-0.08" 
          max="0.08" 
          step="0.001"
          value={deckState.pitch || 0}
          oninput={handlePitchChange}
          class="h-28 w-1 cursor-ns-resize accent-[var(--color-neon-red)] rounded border border-[var(--border-color)] bg-[var(--bg-input)]"
          style="-webkit-appearance: slider-vertical; writing-mode: bt-lr;"
        />
      </div>
      
      <div class="flex flex-col gap-1 {deckState.id === 'deck1' ? 'items-start' : 'items-end'}">
        <span class="text-[9px] font-mono text-[var(--color-text-muted)]">
          {#if deckState.pitch > 0}+{/if}{(deckState.pitch * 100).toFixed(1)}%
        </span>
        <button 
          class="text-[7px] font-display uppercase font-extrabold tracking-widest border border-[var(--border-color)] text-[var(--color-text-muted)] bg-[var(--bg-input)] hover:text-[var(--color-neon-red)] hover:border-[var(--color-neon-red)] rounded px-1 py-0.5 scale-90"
          onclick={() => deck.setPitch(0)}
        >
          RST
        </button>
      </div>
    </div>

    <!-- Main Rotating Platter (Jog Wheel) - Always order-2 (center) -->
    <div class="relative flex-1 flex justify-center items-center order-2">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        id="platter-circle-{deckState.id}"
        class="w-36 h-36 md:w-40 md:h-40 rounded-full border-4 border-[#1f2128] bg-black shadow-[0_0_15px_rgba(0,0,0,0.8)] relative flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden group select-none transition-transform"
        class:panel-border-active={deckState.playing}
        onmousedown={handlePlatterMouseDown}
        ontouchstart={handlePlatterTouchStart}
      >
        <!-- Grooves visual (SVG rings) -->
        <svg class="absolute w-full h-full opacity-20 pointer-events-none" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="white" stroke-width="0.3" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="white" stroke-width="0.3" />
          <circle cx="50" cy="50" r="35" fill="none" stroke="white" stroke-width="0.3" />
          <circle cx="50" cy="50" r="30" fill="none" stroke="white" stroke-width="0.3" />
          <circle cx="50" cy="50" r="25" fill="none" stroke="white" stroke-width="0.3" />
        </svg>

        <!-- Waveform visualizer mapped inside the jog wheel -->
        {#if deckState.waveformPeaks && deckState.waveformPeaks.length > 0}
          <div class="absolute w-[85%] h-[40%] opacity-40 pointer-events-none overflow-hidden flex items-center justify-center">
            <svg class="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
              <path
                d={deckState.waveformPeaks.reduce((path, peak, i) => {
                  const x = i;
                  const y = 50 - (peak * 40);
                  const h = peak * 80;
                  return path + ` M ${x} ${y} l 0 ${h}`;
                }, '')}
                stroke="var(--color-neon-red)"
                stroke-width="1.2"
                fill="none"
              />
            </svg>
          </div>
        {/if}

        <!-- Rotating vinyl indicator strip -->
        <div 
          class="absolute w-full h-full rounded-full transition-transform duration-75 pointer-events-none"
          style="transform: rotate({rotationAngle}deg);"
        >
          <!-- Neon stripe representing position pointer -->
          <div class="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-6 bg-[var(--color-neon-red)] shadow-[0_0_8px_var(--color-neon-red-glow)] rounded-b-md"></div>
          
          <!-- Small labels spin along -->
          <div class="absolute bottom-6 left-1/2 -translate-x-1/2 text-[8px] font-display uppercase tracking-widest text-[var(--color-text-dim)] scale-75 select-none">
            {$t('deck.scratch_mode')}
          </div>
        </div>

        <!-- Center spindle/label -->
        <div class="w-14 h-14 rounded-full border-2 border-[#1f2128] bg-[#0b0b0e] flex flex-col items-center justify-center shadow-inner z-10 pointer-events-none">
          <div class="w-3 h-3 rounded-full bg-slate-900 border border-slate-700"></div>
          <span class="text-[7px] text-[var(--color-text-muted)] font-display tracking-widest uppercase mt-1 scale-90">
            {deckState.id === 'deck1' ? 'A' : 'B'}
          </span>
        </div>

        <!-- Track Title Box (Matches sketch box overlay: "Axel Rose" / "Swedish House...") -->
        <div class="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/90 border border-[#1f2128] px-2 py-0.5 rounded text-[8px] font-display font-black uppercase tracking-wider text-[var(--color-neon-red)] shadow-[0_0_5px_var(--color-neon-red-glow)] z-10 max-w-[80%] truncate">
          {deckState.loadedTrack ? deckState.loadedTrack.title : $t('deck.empty')}
        </div>
      </div>
    </div>
  </div>

  <!-- Bottom controls row (Play, Pause, Cue, Sync, Hot Cues) -->
  <div class="flex flex-col gap-3 border-t border-[var(--border-color)] pt-3">
    <!-- Hot Cues pads -->
    <div class="grid grid-cols-4 gap-2">
      {#each hotCues as cueTime, idx}
        <button
          class="relative h-7 rounded border font-display text-[9px] uppercase font-bold transition-all shadow-sm {cueTime === null ? 'bg-[#111116] border-[var(--border-color)] text-[var(--color-text-muted)]' : 'bg-[var(--color-neon-red-dim)] border-[var(--color-neon-red)] text-[var(--color-text)] shadow-[0_0_6px_var(--color-neon-red-glow)]'}"
          onclick={() => handleHotCue(idx)}
        >
          {idx + 1}
          {#if cueTime !== null}
            <!-- Small clear cue visual -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span 
              class="absolute -top-1.5 -right-1 text-[8px] font-bold text-slate-300 hover:text-white px-0.5 rounded bg-black/80 hover:bg-[#ff2a3b]"
              onclick={(e) => clearHotCue(idx, e)}
            >
              ×
            </span>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Transport Controls (Sync, Cue, Pause, Play) -->
    <div class="flex justify-between items-center gap-2">
      <!-- Sync Button -->
      <button 
        class="flex-1 py-1.5 rounded border text-[10px] font-display uppercase tracking-wider font-extrabold transition-all {deckState.playing ? 'bg-[#111116]/80 text-[var(--color-neon-red)] border-[var(--color-neon-red)] shadow-[0_0_8px_var(--color-neon-red-glow)]' : 'bg-[#111116] border-[var(--border-color)] text-[var(--color-text-muted)]'} {deckState.loadedTrack ? 'hover:border-[#ff2a3b] hover:text-[#ff2a3b]' : ''}"
        onclick={() => deck.syncTo(deckState.id === 'deck1' ? 128 : 120)} 
        disabled={!deckState.loadedTrack}
      >
        {$t('controls.sync')}
      </button>

      <!-- Cue Button -->
      <button 
        class="flex-1 py-1.5 rounded border border-orange-500/50 bg-[#111116] hover:bg-orange-500/10 hover:border-orange-500 text-orange-500 text-[10px] font-display uppercase tracking-wider font-extrabold transition-all"
        onclick={() => deck.playCue()}
        disabled={!deckState.loadedTrack}
      >
        {$t('controls.cue')}
      </button>

      <!-- Play / Pause triggers -->
      {#if deckState.playing}
        <button 
          class="flex-1 py-1.5 rounded border border-[var(--color-neon-red)] bg-[#ff2a3b] text-white hover:bg-[#ff5261] font-display text-[10px] uppercase tracking-wider font-extrabold flex items-center justify-center gap-1 shadow-[0_0_8px_var(--color-neon-red-glow)]"
          onclick={() => deck.pause()}
        >
          <Pause class="w-3 h-3 fill-white stroke-none" />
          {$t('controls.pause')}
        </button>
      {:else}
        <button 
          class="flex-1 py-1.5 rounded border border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-400 font-display text-[10px] uppercase tracking-wider font-extrabold flex items-center justify-center gap-1 shadow-md"
          onclick={() => deck.play()}
          disabled={!deckState.loadedTrack}
        >
          <Play class="w-3 h-3 fill-white stroke-none" />
          {$t('controls.play')}
        </button>
      {/if}
    </div>
  </div>
</div>
