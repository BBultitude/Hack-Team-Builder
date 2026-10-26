import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { serviceWorker } from './scripts/sw-plugin.ts'

export default defineConfig({
  plugins: [preact(), serviceWorker()],
  build: {
    target: 'es2020',
    // Keep every data file as a real, separately cacheable request. Vite
    // would otherwise inline the small ones as base64 data URIs, which
    // bloats the bundle and makes them impossible to swap without a rebuild.
    assetsInlineLimit: 0,
  },
})
