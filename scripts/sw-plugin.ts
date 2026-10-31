import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

/**
 * Emits a service worker that precaches the built shell and data files.
 *
 * Written here rather than pulled in as a plugin dependency: the whole
 * precache list is "everything the build produced", which is a few lines,
 * and the app has no other offline requirements.
 */
export function serviceWorker(): Plugin {
  return {
    name: 'hack-team-builder:service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const urls = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => `/${f}`)
        .sort()

      // Cache name changes whenever any asset hash changes, which is what
      // evicts the previous deploy.
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12)

      const source = `// Generated at build time. Do not edit.
const CACHE = 'htb-${version}'
const PRECACHE = ${JSON.stringify([...urls, '/'], null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Saved games always come from the network; a cached list would undo other devices' changes.
  if (url.pathname.startsWith('/api/')) return

  // Navigations fall back to the cached shell so a reload works offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((r) => r || caches.match('/')),
      ),
    )
    return
  }

  // Everything else is content-hashed, so the cache is always correct.
  event.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
        }
        return res
      }),
    ),
  )
})
`
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
