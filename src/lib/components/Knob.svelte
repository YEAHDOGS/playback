<script>
  // Svelte 5 Runes for properties
  let { 
    value = $bindable(0), 
    min = -12, 
    max = 12, 
    step = 0.1, 
    label = '', 
    resetValue = 0 
  } = $props();

  let startY = 0;
  let startValue = 0;
  let isDragging = false;

  // Map value to angle (-135 to 135 deg)
  let angle = $derived.by(() => {
    const percent = (value - min) / (max - min);
    return -135 + percent * 270;
  });

  function handleDoubleClick() {
    value = resetValue;
  }

  function handleMouseDown(e) {
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startValue = value;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e) {
    if (!isDragging) return;
    const dy = startY - e.clientY; // Upward drag is positive change
    const range = max - min;
    const sensitivity = 0.005; // Drag sensitivity
    const delta = dy * range * sensitivity;
    
    let newValue = startValue + delta;
    newValue = Math.max(min, Math.min(max, newValue));
    // Apply step rounding
    value = Math.round(newValue / step) * step;
  }

  function handleMouseUp() {
    isDragging = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  // Touch support for mobile layouts
  function handleTouchStart(e) {
    if (e.touches.length !== 1) return;
    isDragging = true;
    startY = e.touches[0].clientY;
    startValue = value;

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  function handleTouchMove(e) {
    if (!isDragging || e.touches.length !== 1) return;
    e.preventDefault();
    const dy = startY - e.touches[0].clientY;
    const range = max - min;
    const sensitivity = 0.008;
    const delta = dy * range * sensitivity;

    let newValue = startValue + delta;
    newValue = Math.max(min, Math.min(max, newValue));
    value = Math.round(newValue / step) * step;
  }

  function handleTouchEnd() {
    isDragging = false;
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
  }
</script>

<div class="flex flex-col items-center select-none cursor-pointer group">
  <!-- Dial Container -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div 
    class="relative w-12 h-12 rounded-full border border-[#1f2128] bg-[#111116] flex items-center justify-center transition-shadow group-hover:border-[#ff2a3b]/40 group-active:shadow-[0_0_8px_rgba(255,42,59,0.25)]"
    onmousedown={handleMouseDown}
    ontouchstart={handleTouchStart}
    ondblclick={handleDoubleClick}
  >
    <!-- Rotational marker -->
    <div 
      class="absolute w-full h-full rounded-full transition-transform duration-75"
      style="transform: rotate({angle}deg);"
    >
      <!-- The indicator line -->
      <div class="absolute top-1 left-1/2 -translate-x-1/2 w-[3px] h-2 bg-[#ff2a3b] rounded-full shadow-[0_0_4px_#ff2a3b]"></div>
    </div>

    <!-- Center dot/cap -->
    <div class="w-6 h-6 rounded-full bg-[#050508] border border-[#1f2128] flex items-center justify-center">
      <span class="text-[8px] font-display font-medium text-slate-500 scale-75 uppercase">
        {#if value > 0 && max === 12}+{/if}{Math.round(value * 10) / 10}
      </span>
    </div>
  </div>

  <!-- Knob Label -->
  {#if label}
    <span class="text-[9px] font-display font-semibold uppercase tracking-wider text-slate-400 mt-1 transition-colors group-hover:text-[#ff2a3b]">
      {label}
    </span>
  {/if}
</div>
