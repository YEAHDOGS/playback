<script>
  import { t } from '../i18n.js';
  import { Search, Plus, Upload, Play, Disc } from 'lucide-svelte';

  // Svelte 5 props
  let {
    onLoadTrack = () => {} // callback: (deckId, track)
  } = $props();

  let searchQuery = $state('');
  let isDragOver = $state(false);

  // Default track database
  let tracks = $state([
    {
      id: 'track-1',
      title: 'Paradise Beat',
      artist: 'Axel Rose',
      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      bpm: 120,
      duration: '6:12'
    },
    {
      id: 'track-2',
      title: 'Leave The World',
      artist: 'Swedish House',
      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      bpm: 128,
      duration: '7:05'
    },
    {
      id: 'track-3',
      title: 'Dogs Anthem',
      artist: 'DOGS',
      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
      bpm: 124,
      duration: '5:44'
    }
  ]);

  // Filtered tracks list
  let filteredTracks = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return tracks;
    return tracks.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.artist.toLowerCase().includes(q)
    );
  });

  // Track Drag Start
  function handleDragStart(e, track) {
    e.dataTransfer.setData('text/plain', JSON.stringify(track));
    e.dataTransfer.effectAllowed = 'copy';
  }

  // File Upload drag handlers
  function handleFileDragOver(e) {
    e.preventDefault();
    isDragOver = true;
  }

  function handleFileDragLeave() {
    isDragOver = false;
  }

  function handleFileDrop(e) {
    e.preventDefault();
    isDragOver = false;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      addLocalFiles(files);
    }
  }

  function handleFileInputChange(e) {
    const files = e.target.files;
    if (files.length > 0) {
      addLocalFiles(files);
    }
  }

  function addLocalFiles(filesList) {
    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav')) {
        // Create local track object
        const newTrack = {
          id: `local-${Date.now()}-${i}`,
          title: file.name.replace(/\.[^/.]+$/, ""), // Strip extension
          artist: 'Local File',
          file: file,
          bpm: 120, // default placeholder
          duration: '--:--'
        };
        tracks = [newTrack, ...tracks];
      }
    }
  }
</script>

<div class="panel-border bg-[var(--bg-card)] rounded-xl p-4 flex flex-col gap-4 shadow-md select-none h-full w-full">
  
  <!-- Search & Upload Bar -->
  <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between border-b border-[var(--border-color)] pb-3">
    <div class="flex items-center gap-2">
      <Disc class="w-5 h-5 text-[var(--color-neon-red)] animate-spin" style="animation-duration: 4s;" />
      <h3 class="font-display font-bold uppercase tracking-wider text-sm text-[var(--color-text)]">
        {$t('library.header')}
      </h3>
    </div>

    <div class="flex gap-2 flex-1 sm:max-w-md">
      <!-- Search Input -->
      <div class="relative flex-1">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-dim)]" />
        <input 
          type="text" 
          placeholder={$t('library.search')}
          bind:value={searchQuery}
          class="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] text-xs text-[var(--color-text)] focus:border-[var(--color-neon-red)] outline-none transition-colors"
        />
      </div>

      <!-- File Upload button -->
      <label class="px-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--color-neon-red)] hover:text-[var(--color-neon-red)] text-[var(--color-text-muted)] cursor-pointer text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors">
        <Upload class="w-3.5 h-3.5" />
        <span class="hidden md:inline">Add Files</span>
        <input 
          type="file" 
          accept="audio/*" 
          multiple 
          onchange={handleFileInputChange} 
          class="hidden" 
        />
      </label>
    </div>
  </div>

  <!-- Drag and Drop / List Split -->
  <div class="flex flex-col lg:flex-row gap-4 items-stretch flex-1 overflow-hidden h-[180px] md:h-[220px]">
    
    <!-- Drag & Drop Overlay Zone -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      class="flex-1 lg:max-w-[240px] border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center gap-2 cursor-pointer transition-all {isDragOver ? 'border-[var(--color-neon-red)] bg-[var(--color-neon-red-glow-subtle)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]/25'}"
      ondragover={handleFileDragOver}
      onleave={handleFileDragLeave}
      ondrop={handleFileDrop}
    >
      <Upload class="w-8 h-8 text-[var(--color-text-dim)] group-hover:text-[var(--color-neon-red)]" />
      <span class="text-[10px] font-semibold text-[var(--color-text-muted)] leading-relaxed">
        {$t('library.drag_drop')}
      </span>
    </div>

    <!-- Track List Table -->
    <div class="flex-1 overflow-y-auto border border-[var(--border-color)] bg-black/10 rounded-lg">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-[var(--bg-panel)] sticky top-0 border-b border-[var(--border-color)] text-[10px] font-display uppercase tracking-wider text-[var(--color-text-muted)]">
          <tr>
            <th class="py-2 px-3 font-semibold w-8"></th>
            <th class="py-2 px-3 font-semibold">{$t('library.title')}</th>
            <th class="py-2 px-3 font-semibold">{$t('library.artist')}</th>
            <th class="py-2 px-3 font-semibold text-center w-16">{$t('controls.bpm')}</th>
            <th class="py-2 px-3 text-right w-20"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border-color)]">
          {#each filteredTracks as track (track.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <tr 
              draggable="true"
              ondragstart={(e) => handleDragStart(e, track)}
              class="hover:bg-[var(--bg-panel)]/40 cursor-grab active:cursor-grabbing transition-colors group"
            >
              <td class="py-2 px-3 text-center">
                <Disc class="w-3.5 h-3.5 text-[var(--color-text-dim)] group-hover:text-[var(--color-neon-red)]" />
              </td>
              <td class="py-2 px-3 font-medium text-[var(--color-text)] truncate max-w-[150px]">
                {track.title}
              </td>
              <td class="py-2 px-3 text-[var(--color-text-muted)] truncate max-w-[120px]">
                {track.artist}
              </td>
              <td class="py-2 px-3 text-center text-slate-400 font-mono font-bold">
                {track.bpm}
              </td>
              <td class="py-2 px-3 text-right pr-4">
                <!-- Mobile Friendly Load triggers -->
                <div class="hidden group-hover:flex items-center justify-end gap-1.5">
                  <button 
                    class="px-2 py-0.5 text-[9px] font-display font-semibold uppercase tracking-wider rounded border border-[var(--border-color)] hover:border-[#ff2a3b] hover:text-[#ff2a3b] bg-[var(--bg-input)]"
                    onclick={() => onLoadTrack('deck1', track)}
                  >
                    1
                  </button>
                  <button 
                    class="px-2 py-0.5 text-[9px] font-display font-semibold uppercase tracking-wider rounded border border-[var(--border-color)] hover:border-[#ff2a3b] hover:text-[#ff2a3b] bg-[var(--bg-input)]"
                    onclick={() => onLoadTrack('deck2', track)}
                  >
                    2
                  </button>
                </div>
              </td>
            </tr>
          {/each}
          {#if filteredTracks.length === 0}
            <tr>
              <td colspan="5" class="py-8 text-center text-slate-500 font-medium">
                No tracks found
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>

  </div>

</div>
