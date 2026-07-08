<script>
  let {
    peaks = [],
    currentTime = 0,
    duration = 0,
    isDecoding = false,
    onScrub = () => {}
  } = $props();

  let canvas = $state(null);
  let container = $state(null);

  // Redraw whenever relevant properties change
  $effect(() => {
    if (!canvas) return;
    drawWaveform();
  });

  // Watch container resize
  $effect(() => {
    if (!container || !canvas) return;
    const resizeObserver = new ResizeObserver(() => {
      drawWaveform();
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  });

  function drawWaveform() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions based on client bounds
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = rect.width;
    const h = rect.height;

    // Clear background
    ctx.fillStyle = '#0b0b0e';
    ctx.fillRect(0, 0, w, h);

    if (peaks.length === 0) {
      // Draw placeholder flat line
      ctx.strokeStyle = '#1f2128';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    const progress = duration > 0 ? currentTime / duration : 0;
    const barWidth = w / peaks.length;
    const centerY = h / 2;

    // Draw waveform bars
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const barHeight = peaks[i] * (h * 0.85); // Scale peaks to fit 85% of height
      const y1 = centerY - barHeight / 2;
      const y2 = centerY + barHeight / 2;

      const isPlayed = (i / peaks.length) < progress;

      // Draw bar line
      ctx.lineWidth = Math.max(1, barWidth - 1);
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);

      if (isPlayed) {
        // Glowing Neon Red for played part
        ctx.strokeStyle = '#ff2a3b';
        ctx.shadowColor = 'rgba(255, 42, 59, 0.4)';
        ctx.shadowBlur = 4;
      } else {
        // Muted grey/red for unplayed part
        ctx.strokeStyle = '#373740';
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }

    // Draw Playhead
    ctx.shadowBlur = 0;
    const playheadX = progress * w;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();

    // Playhead glowing handle
    ctx.fillStyle = '#ff2a3b';
    ctx.beginPath();
    ctx.arc(playheadX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function handleInteraction(e) {
    if (!canvas || duration === 0) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onScrub(percent);
  }

  let isMouseDown = false;

  function onMouseDown(e) {
    isMouseDown = true;
    handleInteraction(e);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isMouseDown) return;
    handleInteraction(e);
  }

  function onMouseUp() {
    isMouseDown = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  // Touch handlers
  function onTouchStart(e) {
    handleInteraction(e);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }

  function onTouchMove(e) {
    e.preventDefault();
    handleInteraction(e);
  }

  function onTouchEnd() {
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  bind:this={container} 
  class="relative w-full h-12 bg-[#0b0b0e] border border-[#1f2128] rounded cursor-ew-resize select-none overflow-hidden"
  onmousedown={onMouseDown}
  ontouchstart={onTouchStart}
>
  <canvas bind:this={canvas} class="w-full h-full block"></canvas>

  <!-- Decoding / Loading Spinner -->
  {#if isDecoding}
    <div class="absolute inset-0 bg-[#030305]/85 flex items-center justify-center gap-2">
      <div class="w-4 h-4 border-2 border-[#ff2a3b] border-t-transparent rounded-full animate-spin"></div>
      <span class="text-[10px] font-display uppercase tracking-widest text-[#ff2a3b] text-glow animate-pulse">
        Analyzing Waveform...
      </span>
    </div>
  {/if}
</div>
