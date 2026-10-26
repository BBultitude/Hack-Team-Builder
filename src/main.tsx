import { render } from 'preact'
import { App } from './ui/App'
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
