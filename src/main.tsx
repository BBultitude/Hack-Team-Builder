import { render } from 'preact'
import { App } from './ui/App'
// Bundled so the site works offline and never calls a font host.
import '@fontsource/atkinson-hyperlegible/latin-400.css'
import '@fontsource/atkinson-hyperlegible/latin-700.css'
import '@fontsource/vt323/latin-400.css'
import './styles.css'

const root = document.getElementById('app')
if (root) render(<App />, root)

// Offline support. Dev is left alone so hot reloading keeps working.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal: the app just will not work offline.
    })
  })
}
