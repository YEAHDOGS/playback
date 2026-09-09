<script>
  import { t } from '../i18n.js';
  import { ListMusic, Play, X, Trash2, SkipBack, SkipForward } from 'lucide-svelte';

  // Renders the persistent session queue (PlaybackQueue instance). Pure
  // presentation — every button fans out to callbacks owned by App.svelte.
  let {
    queue = null,
    droppedCount = 0,
    onPlayAt = () => {},
    onRemoveAt = () => {},
    onClear = () => {},
    onPrev = () => {},
    onNext = () => {}
  } = $props();

  const items = $derived(queue ? queue.items : []);
  const currentIndex = $derived(queue ? queue.index : -1);
</script>

<div class="panel-border bg-[var(--bg-card)] rounded-xl p-3 flex flex-col gap-2 shadow-md select-none w-full">
  <div class="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
    <div class="flex items-center gap-2">
      <ListMusic class="w-4 h-4 text-[var(--color-neon-red)]" />
      <h3 class="font-display font-bold uppercase tracking-wider text-xs text-[var(--color-text)]">
        {$t('queue.header')}
      </h3>
      {#if items.length > 0}
        <span class="text-[9px] font-mono bg-[var(--bg-input)] border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[var(--color-text-muted)]">
          {items.length}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button
        class="p-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--color-text-muted)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer"
        title={$t('queue.prev')}
        onclick={onPrev}
      >
        <SkipBack class="w-3.5 h-3.5" />
      </button>
      <button
        class="p-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--color-text-muted)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer"
        title={$t('queue.next')}
        onclick={onNext}
      >
        <SkipForward class="w-3.5 h-3.5" />
      </button>
      <button
        class="p-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--color-text-muted)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer"
        title={$t('queue.clear')}
        onclick={onClear}
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>

  {#if droppedCount > 0}
    <p class="text-[10px] text-amber-400/90 leading-snug">
      {$t('queue.dropped', { values: { count: droppedCount } })}
    </p>
  {/if}

  {#if items.length === 0}
    <p class="text-[11px] text-[var(--color-text-muted)] leading-relaxed py-2 text-center">
      {$t('queue.empty')}
    </p>
  {:else}
    <ol class="flex flex-col gap-1 max-h-40 overflow-y-auto">
      {#each items as item, i (item.id)}
        <li
          class="flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[11px] transition-colors {i === currentIndex ? 'border-[var(--color-neon-red)] bg-[var(--color-neon-red-dim)]' : 'border-transparent hover:bg-[var(--bg-panel)]/40'}"
        >
          <span class="font-mono text-[9px] text-[var(--color-text-muted)] w-5 text-center shrink-0">
            {i === currentIndex ? '▶' : i + 1}
          </span>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-[var(--color-text)] truncate leading-tight">{item.title}</p>
            <p class="text-[10px] text-[var(--color-text-muted)] truncate leading-tight">{item.artist}</p>
          </div>
          {#if i !== currentIndex}
            <button
              class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer shrink-0"
              title={$t('queue.play')}
              onclick={() => onPlayAt(i)}
            >
              <Play class="w-3.5 h-3.5" />
            </button>
          {/if}
          <button
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer shrink-0"
            title={$t('queue.remove')}
            onclick={() => onRemoveAt(i)}
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</div>
