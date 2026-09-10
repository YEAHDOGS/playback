<script>
  import { t } from '../i18n.js';
  import { X } from 'lucide-svelte';
  import { SHORTCUT_ROWS } from '../shortcuts.js';

  // Svelte 5 props
  let {
    open = false,
    onClose = () => {}
  } = $props();

  let closeBtn = $state(null);

  // When the overlay opens, move focus to the close button so keyboard
  // users can Escape/close without hunting for it.
  $effect(() => {
    if (open && closeBtn) closeBtn.focus();
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    onclick={() => onClose()}
  >
    <div
      class="w-full max-w-sm bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={$t('shortcuts.title')}
    >
      <div class="flex justify-between items-center border-b border-[var(--border-color)] pb-3 mb-4">
        <h3 class="font-display font-extrabold uppercase tracking-widest text-sm text-[var(--color-text)]">
          {$t('shortcuts.title')}
        </h3>
        <button
          bind:this={closeBtn}
          class="p-1 rounded-lg border border-[var(--border-color)] text-[var(--color-text-muted)] hover:border-[#ff2a3b] hover:text-[#ff2a3b] bg-[var(--bg-input)] cursor-pointer"
          onclick={() => onClose()}
          aria-label={$t('shortcuts.close')}
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <ul class="flex flex-col gap-2.5">
        {#each SHORTCUT_ROWS as row}
          <li class="flex items-center justify-between gap-4 text-xs">
            <span class="text-[var(--color-text-muted)]">
              {$t(`shortcuts.${row.action}`)}
            </span>
            <span class="flex gap-1 shrink-0">
              {#each row.keys as k}
                <kbd class="min-w-7 text-center px-1.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] font-mono font-bold text-[var(--color-text)]">
                  {k}
                </kbd>
              {/each}
            </span>
          </li>
        {/each}
      </ul>

      <p class="mt-5 text-[10px] text-[var(--color-text-muted)] leading-relaxed border-t border-[var(--border-color)] pt-3">
        {$t('shortcuts.hint')}
      </p>
    </div>
  </div>
{/if}
