<script>
  import { t } from '../i18n.js';
  import Knob from './Knob.svelte';

  // Svelte 5 props
  let {
    engine = null,
    deck1 = null,
    deck2 = null,
    deck1State = {},
    deck2State = {},
    masterVolume = 0.8,
    crossfader = 0.0
  } = $props();

  let level1 = $state(0);
  let level2 = $state(0);

  // Animation frame loop to update LED volume meters
  let animationFrame;
  $effect(() => {
    if (engine && engine.initialized) {
      const updateMeters = () => {
        if (deck1) level1 = deck1.getVolumeLevel();
        if (deck2) level2 = deck2.getVolumeLevel();
        animationFrame = requestAnimationFrame(updateMeters);
      };
      updateMeters();
      return () => cancelAnimationFrame(animationFrame);
    }
  });

  // LED Segment thresholds (10 segments)
  const segments = [
    { thresh: 0.1, color: 'text-emerald-500' },
    { thresh: 0.2, color: 'text-emerald-500' },
    { thresh: 0.3, color: 'text-emerald-500' },
    { thresh: 0.4, color: 'text-emerald-500' },
    { thresh: 0.5, color: 'text-emerald-500' },
    { thresh: 0.6, color: 'text-emerald-500' },
    { thresh: 0.7, color: 'text-amber-500' },
    { thresh: 0.8, color: 'text-amber-500' },
    { thresh: 0.9, color: 'text-red-500' },
    { thresh: 0.98, color: 'text-red-600' }
  ];

  function handleMasterVolume(val) {
    if (engine) engine.setMasterVolume(val);
  }

  function handleCrossfader(e) {
    if (engine) engine.setCrossfader(parseFloat(e.target.value));
  }

  function handleVolume1(e) {
    if (deck1) deck1.setVolume(parseFloat(e.target.value));
  }

  function handleVolume2(e) {
    if (deck2) deck2.setVolume(parseFloat(e.target.value));
  }
</script>

<div class="panel-border bg-[var(--bg-card)] rounded-xl p-4 flex flex-col items-center justify-between shadow-md select-none w-full h-full min-h-[360px] md:min-h-[400px]">
  
  <!-- Master Section -->
  <div class="flex flex-col items-center border-b border-[var(--border-color)] pb-3 w-full shrink-0">
    <Knob 
      value={masterVolume} 
      min={0} 
      max={1.0} 
      step={0.01} 
      resetValue={0.8}
      label={$t('controls.master')}
      onvaluechange={handleMasterVolume}
    />
  </div>

  <!-- Main Mixer: Channels & EQs -->
  <div class="flex flex-1 justify-between w-full gap-4 md:gap-6 py-4">
    <!-- Channel 1 EQs -->
    <div class="flex flex-col items-center justify-between gap-3 flex-1 border-r border-[var(--border-color)] pr-2">
      <Knob 
        value={deck1State.eqHigh || 0} 
        min={-12} 
        max={12} 
        label="Hi" 
        onvaluechange={(v) => deck1 && deck1.setEQ('high', v)}
      />
      <Knob 
        value={deck1State.eqMid || 0} 
        min={-12} 
        max={12} 
        label="Mid" 
        onvaluechange={(v) => deck1 && deck1.setEQ('mid', v)}
      />
      <Knob 
        value={deck1State.eqLow || 0} 
        min={-12} 
        max={12} 
        label="Low" 
        onvaluechange={(v) => deck1 && deck1.setEQ('low', v)}
      />
    </div>

    <!-- Center Section: LED Meters & Volume Faders -->
    <div class="flex items-stretch justify-center gap-2 md:gap-4 px-1 min-w-[120px]">
      
      <!-- Deck 1 Volume Slider -->
      <div class="flex flex-col items-center justify-end h-full">
        <input 
          type="range" 
          min="0" 
          max="1.0" 
          step="0.01"
          value={deck1State.volume ?? 1.0}
          oninput={handleVolume1}
          class="h-28 w-1 cursor-ns-resize accent-[var(--color-neon-red)] rounded bg-[var(--bg-input)] border border-[var(--border-color)]"
          style="-webkit-appearance: slider-vertical; writing-mode: bt-lr;"
        />
        <span class="text-[8px] font-display font-semibold text-[var(--color-text-muted)] mt-2 uppercase tracking-wide">
          Ch 1
        </span>
      </div>

      <!-- LED Level Meters -->
      <div class="flex items-center gap-1.5 h-28 border border-[var(--border-color)] bg-black/40 rounded px-1 self-start mt-1 shrink-0">
        <!-- Deck 1 LEDs -->
        <div class="flex flex-col-reverse justify-between h-full gap-[2px]">
          {#each segments as seg}
            <div 
              class="w-[3px] h-[7px] rounded-sm transition-all duration-75 {level1 < seg.thresh ? 'bg-slate-800' : 'led-active ' + seg.color}"
              style={level1 >= seg.thresh ? `background-color: currentColor;` : ''}
            ></div>
          {/each}
        </div>

        <!-- Deck 2 LEDs -->
        <div class="flex flex-col-reverse justify-between h-full gap-[2px]">
          {#each segments as seg}
            <div 
              class="w-[3px] h-[7px] rounded-sm transition-all duration-75 {level2 < seg.thresh ? 'bg-slate-800' : 'led-active ' + seg.color}"
              style={level2 >= seg.thresh ? `background-color: currentColor;` : ''}
            ></div>
          {/each}
        </div>
      </div>

      <!-- Deck 2 Volume Slider -->
      <div class="flex flex-col items-center justify-end h-full">
        <input 
          type="range" 
          min="0" 
          max="1.0" 
          step="0.01"
          value={deck2State.volume ?? 1.0}
          oninput={handleVolume2}
          class="h-28 w-1 cursor-ns-resize accent-[var(--color-neon-red)] rounded bg-[var(--bg-input)] border border-[var(--border-color)]"
          style="-webkit-appearance: slider-vertical; writing-mode: bt-lr;"
        />
        <span class="text-[8px] font-display font-semibold text-[var(--color-text-muted)] mt-2 uppercase tracking-wide">
          Ch 2
        </span>
      </div>

    </div>

    <!-- Channel 2 EQs -->
    <div class="flex flex-col items-center justify-between gap-3 flex-1 border-l border-[var(--border-color)] pl-2">
      <Knob 
        value={deck2State.eqHigh || 0} 
        min={-12} 
        max={12} 
        label="Hi" 
        onvaluechange={(v) => deck2 && deck2.setEQ('high', v)}
      />
      <Knob 
        value={deck2State.eqMid || 0} 
        min={-12} 
        max={12} 
        label="Mid" 
        onvaluechange={(v) => deck2 && deck2.setEQ('mid', v)}
      />
      <Knob 
        value={deck2State.eqLow || 0} 
        min={-12} 
        max={12} 
        label="Low" 
        onvaluechange={(v) => deck2 && deck2.setEQ('low', v)}
      />
    </div>
  </div>

  <!-- Bottom Crossfader Section -->
  <div class="flex flex-col items-center border-t border-[var(--border-color)] pt-3 w-full shrink-0">
    <div class="w-full max-w-[180px] flex flex-col items-center gap-1.5">
      <input 
        type="range" 
        min="-1.0" 
        max="1.0" 
        step="0.01"
        value={crossfader}
        oninput={handleCrossfader}
        class="w-full h-1 cursor-ew-resize accent-[var(--color-neon-red)] rounded bg-[var(--bg-input)] border border-[var(--border-color)]"
      />
      <div class="w-full flex justify-between text-[8px] font-display font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
        <span>L</span>
        <span>{$t('controls.crossfader')}</span>
        <span>R</span>
      </div>
    </div>
  </div>

</div>
