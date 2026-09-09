<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<script>
  import { t } from '../i18n.js';
  import { ListMusic, Play, X, Trash2, SkipBack, SkipForward, ChevronUp, ChevronDown } from 'lucide-svelte';

  // Renders the persistent session queue (PlaybackQueue instance). Pure
  // presentation — every button fans out to callbacks owned by App.svelte.
  //
  // Keyboard navigation: rows carry a roving tabindex. ArrowUp/ArrowDown move
  // DOM focus between rows (works from the row itself or any button inside
  // it), Home/End jump to the ends, and Enter/Space on a focused row plays
  // that entry. The handled keys are swallowed (preventDefault +
  // stopPropagation) so the global transport shortcuts in keyboard.js
  // (Space = deck 1 toggle, arrows = volume/crossfader) stay quiet while the
  // queue has focus.
  let {
    queue = null,
    droppedCount = 0,
    onPlayAt = () => {},
    onRemoveAt = () => {},
    onClear = () => {},
    onPrev = () => {},
    onNext = () => {},
    onMoveUp = () => {},
    onMoveDown = () => {}
  } = $props();

  const items = $derived(queue ? queue.items : []);
  const currentIndex = $derived(queue ? queue.index : -1);

  /** Roving tab stop — exactly one row is in the tab order at a time. */
  let focusRow = $state(0);
  /** Ref to the <ol> for programmatic row focus. */
  let listEl = $state(null);

  const clampRow = (i) => Math.max(0, Math.min(items.length - 1, i));

  function focusRowEl(i) {
    listEl?.querySelector(`li[data-row="${i}"]`)?.focus();
  }

  /** @param {KeyboardEvent} e */
  function onListKeyDown(e) {
    if (items.length === 0) return;
    const target = e.target;
    const li = target instanceof Element ? target.closest('li[data-row]') : null;
    if (!li) return;
    const i = Number(li.dataset.row);

    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
        next = clampRow(i + 1);
        break;
      case 'ArrowUp':
        next = clampRow(i - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Enter':
      case ' ':
        // Row itself focused (not an inner button) — play that entry.
        // The play button is hidden on the current row, so Enter there
        // stays a no-op rather than restarting the track.
        if (target === li && i !== currentIndex) {
          e.preventDefault();
          e.stopPropagation();
          focusRow = i;
          onPlayAt(i);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    focusRow = next;
    focusRowEl(next);
  }
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
        aria-label={$t('queue.prev')}
        onclick={onPrev}
      >
        <SkipBack class="w-3.5 h-3.5" />
      </button>
      <button
        class="p-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--color-text-muted)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer"
        title={$t('queue.next')}
        aria-label={$t('queue.next')}
        onclick={onNext}
      >
        <SkipForward class="w-3.5 h-3.5" />
      </button>
      <button
        class="p-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--color-text-muted)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer"
        title={$t('queue.clear')}
        aria-label={$t('queue.clear')}
        onclick={onClear}
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>

  {#if droppedCount > 0}
    <p role="status" class="text-[10px] text-amber-400/90 leading-snug">
      {$t('queue.dropped', { values: { count: droppedCount } })}
    </p>
  {/if}

  {#if items.length === 0}
    <p class="text-[11px] text-[var(--color-text-muted)] leading-relaxed py-2 text-center">
      {$t('queue.empty')}
    </p>
  {:else}
    <p class="sr-only">{$t('queue.keyboard_hint')}</p>
    <ol
      aria-label={$t('queue.list')}
      class="flex flex-col gap-1 max-h-40 overflow-y-auto"
      bind:this={listEl}
      onkeydown={onListKeyDown}
    >
      {#each items as item, i (item.id)}
        <li
          data-row={i}
          tabindex={i === clampRow(focusRow) ? 0 : -1}
          class="flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-neon-red)] focus-visible:outline-offset-1 {i === currentIndex ? 'border-[var(--color-neon-red)] bg-[var(--color-neon-red-dim)]' : 'border-transparent hover:bg-[var(--bg-panel)]/40'}"
          aria-current={i === currentIndex ? true : undefined}
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
              aria-label={$t('queue.play')}
              onclick={() => onPlayAt(i)}
            >
              <Play class="w-3.5 h-3.5" />
            </button>
          {/if}
          <button
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer shrink-0 disabled:opacity-25 disabled:pointer-events-none"
            title={$t('queue.move_up')}
            aria-label={$t('queue.move_up')}
            onclick={() => onMoveUp(i)}
            disabled={i === 0}
          >
            <ChevronUp class="w-3.5 h-3.5" />
          </button>
          <button
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer shrink-0 disabled:opacity-25 disabled:pointer-events-none"
            title={$t('queue.move_down')}
            aria-label={$t('queue.move_down')}
            onclick={() => onMoveDown(i)}
            disabled={i === items.length - 1}
          >
            <ChevronDown class="w-3.5 h-3.5" />
          </button>
          <button
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-neon-red)] transition-colors cursor-pointer shrink-0"
            title={$t('queue.remove')}
            aria-label={$t('queue.remove')}
            onclick={() => onRemoveAt(i)}
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</div>
