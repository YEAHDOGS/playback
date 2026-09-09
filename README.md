# Playback by DOGS

A web-based, customizable DJ interface — two decks, a mixer, and a track library — built with Svelte 5, Vite, Tailwind CSS, and SCSS. Everything runs on the Web Audio API: no backend, no account, no build step needed to poke at it.

[Made by DOGS](https://wearedogs.com)

## What it does

- **Two decks** — drag & drop (or double-click) tracks onto a deck, scratch the jog wheel (mouse + touch), pitch fader (±8%), hot cues, sync, elapsed/remaining time display
- **Mixer** — 3-band EQ per channel, channel volumes, LED level meters, equal-power crossfader, master volume
- **Waveforms** — decoded offline via `decodeAudioData` (300 peaks/track) with click-to-seek; falls back to a synthetic waveform when CORS or decoding fails
- **Track library** — loads with three sample MP3s streamed from soundhelix.com (needs internet), plus search, local file upload (MP3/WAV via drag & drop or file picker)
- **Persistent playback queue** — your track order survives reloads (`localStorage`); reopens paused at the saved track and position, never autoplayed. Entries that no longer exist in the catalog are pruned on boot. See `src/lib/queue/PlaybackQueue.js`
- **Themes** — Night (neon red/black) and Daytime (icy white), persisted per session
- **i18n** — English + Spanish via `svelte-i18n`; strings live in `src/locales/`
- **MIDI controllers** — connect hardware via Web MIDI in Settings; see [MIDI](#midi-controllers) below
- **Keyboard shortcuts** — see [Shortcuts](#keyboard-shortcuts) below

## Run it

```bash
npm install
npm run dev      # dev server with hot reload
npm test         # vitest suite: crossfader math, loudness guard, queue persistence
```

`npm run dev` is the way Brandon runs it day-to-day; per repo convention the production build isn't the verification path.

### Staging on GitHub Pages

The Pages project URL is `https://yeahdogs.github.io/playback/`, so assets must live under `/playback/`. Build staging with:

```bash
GITHUB_PAGES=1 npx vite build   # base becomes /playback/; plain dev/build stays at /
```

### First 60 seconds

1. Open the dev-server URL, then click **Start DJing** — browsers only unlock the Web Audio context on a user gesture, so nothing makes sound until you do.
2. Double-click a library track (they stream from SoundHelix sample MP3s, so this part needs internet) or drag in your own MP3/WAV to load a deck, then hit play.
3. Drag the **crossfader** at the bottom of the mixer — you should hear audio move L/R with no volume dip in the center (equal-power curve). Arrow keys nudge it ±0.05.

## Architecture

```
src/
├── App.svelte                  # shell: header, deck grid, settings drawer, drag & drop
├── lib/
│   ├── audio/
│   │   ├── DjEngine.js         # AudioContext, master gain, crossfader, deck coordination
│   │   ├── AudioDeck.js        # one deck: HTMLAudioElement -> EQ -> gain -> analyser
│   │   ├── MidiBridge.js       # Web MIDI -> DjEngine bindings (default map + overrides)
│   │   └── DjEngine.test.js    # equal-power crossfader math tests
│   ├── catalog.js              # canonical demo track catalog (queue restore + libraries)
│   ├── queue/
│   │   ├── PlaybackQueue.js      # persistent queue: localStorage, reorder, stale pruning
│   │   └── PlaybackQueue.test.js # queue persistence regression tests
│   ├── components/
│   │   ├── Platter.svelte      # jog wheel, pitch fader, transport, hot cues
│   │   ├── Mixer.svelte        # EQs, channel faders, LED meters, crossfader
│   │   ├── Waveform.svelte     # canvas waveform with scrubbing
│   │   ├── TrackList.svelte    # library: search, upload, drag & drop, enqueue
│   │   ├── QueuePanel.svelte   # session queue: play-now, remove, prev/next, clear
│   │   └── Knob.svelte         # rotary control (mouse + touch + double-click reset)
│   ├── keyboard.js             # keyboard transport shortcuts
│   └── i18n.js                 # svelte-i18n setup
├── locales/{en,es}.json
└── styles/variables.scss       # theme tokens (Night/Daytime CSS custom properties)
```

State flows one way: `DjEngine`/`AudioDeck` own the audio graph and push plain state snapshots up through `onChange` callbacks; Svelte components render those snapshots and call back down through the public API (`play()`, `setEQ()`, `syncTo()`, ...). Presentation never touches audio nodes directly.

## Audio graph

```
Deck source (HTMLAudioElement)
  -> lowshelf (250 Hz) -> peaking (1 kHz) -> highshelf (4 kHz)
  -> deck gain -> analyser (level meters)
  -> crossfader gain (equal-power curve: cos/sin, constant power sum)
  -> master gain -> destination
```

Pitch is implemented with `playbackRate` (simple, low-latency, pitch-shifts with tempo like vinyl). True time-stretch (tempo without pitch change) is on the roadmap.

## Keyboard shortcuts

| Key | Action |
| --- | ------ |
| `Space` | Play/pause deck 1 |
| `X` | Play/pause deck 2 |
| `C` / `V` | Cue-play deck 1 / deck 2 |
| `S` | Sync deck 1 to deck 2's tempo |
| `←` / `→` | Nudge crossfader |
| `↑` / `↓` | Master volume |

Shortcuts are ignored while typing in the library search or any input.

## Persistent playback queue

The queue is the persistent bit of your session. It lives in `localStorage`
(`playback.queue.v1`) and survives reloads:

- Every change is saved immediately — add, play-next, remove, reorder, clear.
- On boot, the queue rehydrates against the current track catalog: entries whose
  track id no longer exists are dropped (the drop count is reported back so the
  UI can note it), and the saved track index / seek position are restored.
- **Restoring never starts playback.** Browsers block autoplay without a user
  gesture, so the correct behavior is "resume paused at the saved track and
  position" — the queue module exposes no `play()` at all; audio starts only
  from a gesture in the UI.
- Corrupt or version-mismatched stored data boots to an empty queue rather than
  poisoning state. Local uploads are stripped to serializable metadata on save
  (`File` blobs can't survive a reload).

Wire-up (2026-09-09): `PlaybackQueue` is wired into `App.svelte`. On boot
the queue restores against the canonical catalog (`src/lib/catalog.js`);
pruned entries are reported once in the panel. Hovering a library track shows
a **+Q** enqueue button (each `TrackList` also reports its live library —
demo catalog + local uploads — upward so queue snapshots resolve back to
full track objects with their `File` refs while the session is alive).
`QueuePanel` (under deck 1's library) plays entries on deck 1, removes,
reorders via prev/next, and clears. The playhead is persisted while deck 1
plays the queue's current track (throttled + flushed on pause), and replaying
the restored entry resumes at the saved position (`loadTrack`'s `startAt`,
clamped inside the track duration so a stale position can't skip the track).
When a deck plays a track **from the queue** to completion, the next entry
auto-advances on that deck; manually loaded tracks never auto-advance.

## MIDI controllers

Open Settings → **Connect MIDI Controller** and authorize Web MIDI (requires HTTPS or localhost — a browser security rule, not a Playback limitation). The default map drives a generic 2-deck controller:

| Control | Default binding |
| ------- | --------------- |
| Master volume | CC 7 |
| Crossfader | CC 8 |
| Deck 1 / 2 volume | CC 16 / 17 |
| Play/pause deck 1 / 2 | Notes 60 / 61 |
| Cue deck 1 / 2 | Notes 62 / 63 |
| Sync deck 1 / 2 | Notes 64 / 65 |

Controllers all speak different dialects: unmapped messages are logged to the console so you can read your device's real numbers and override them by passing a `map` to `MidiBridge` (see `DEFAULT_MIDI_MAP` in `src/lib/audio/MidiBridge.js`).

## Streaming integrations — honest status

The original pitch named Spotify, SoundCloud, Tidal, and Apple Music. None are integrated yet, and the reality check matters before anyone builds them:

- **Spotify** — the only realistic path is the [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk): it needs a Spotify Developer app (client ID), user OAuth login, and a **Premium** account per listener. It can't be done client-side-only with no credentials, and full-catalog streaming stays inside Spotify's player — you can't route it through the Web Audio EQ graph above. Feasible, but it's an OAuth + Premium-gated feature, not a drop-in source.
- **SoundCloud / Tidal / Apple Music** — no browser playback APIs for third-party web apps; their streams are DRM/licensing-walled. A "login and play anything" integration is not technically possible from a static site.

What *is* feasible without credentials: direct audio file URLs (already works — that's what the demo tracks are), local files (works), and a backend proxy that resolves URLs you own. Any streaming integration beyond that needs Brandon's call on OAuth apps and licensing.

## Roadmap ideas

- True time-stretch (phase vocoder / WSOLA) so tempo changes don't shift pitch
- Beatgrid + auto BPM detection (onset detection on the decoded buffer we already have)
- Recording mixes via `MediaRecorder` on the master gain node
- Sampler pads / loop rolls per deck
- Persistent library + cue points (IndexedDB; R2 sync per the DOGS data strategy)
- Streaming integrations — see the reality check above; needs Brandon's decision
- PWA packaging for offline booth use

## Repo conventions (from AGENTS.md)

- Svelte 5 runes, Tailwind-first styling, SCSS for custom work (`@use`, never `@import`)
- Logic lives in `src/lib`, never mixed into markup; no file over 1000 lines
- Zero-warning compilation is the bar — a warning is a future bug
- Work happens on branches; **never push, never touch master from automation**

## License

MIT — see [LICENSE](LICENSE).
