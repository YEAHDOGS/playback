// catalog.js — the canonical track catalog for the app.
//
// TrackList's demo library, the persistent queue's restore/prune catalog, and
// the App-level queue resolution all read from this one list, so a track id
// means the same thing everywhere. Local uploads live on top of this (they
// are reported up by TrackList via onTracksChange and merged into the live
// catalog in App.svelte); they can never survive a reload, so they are always
// pruned by PlaybackQueue.restore() — the snapshots keep serializable
// metadata only.

export const DEMO_TRACKS = [
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
];
