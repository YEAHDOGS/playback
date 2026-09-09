import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages project path: build with GITHUB_PAGES=1 so /assets/... and
  // /favicon.svg become /playback/... on yeahdogs.github.io/playback/.
  // Dev (`npm run dev`) stays at root, untouched.
  base: process.env.GITHUB_PAGES ? '/playback/' : '/',
  plugins: [
    tailwindcss(),
    svelte()
  ],
  // Component tests (`npm test`): jsdom + the browser condition so `svelte`
  // resolves to the client build (mount/render) instead of the server entry.
  // Gated on VITEST so dev/build resolution stays on vite's defaults.
  test: {
    environment: 'jsdom',
  },
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
})
