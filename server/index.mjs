/**
 * The whole deployment: serves the built site from dist/ and keeps game
 * setups under /api/setups, one JSON file each in DATA_DIR. Plain Node, no
 * dependencies, so the container is one process and one volume.
 *
 *   node server/index.mjs       PORT (3000), DIST_DIR (./dist), DATA_DIR (./.data), ACCESS_CODE (optional)
 */
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest'])

/** Same rule the client uses for new ids; also what keeps a path inside DATA_DIR. */
const SETUP_ID = /^[a-z0-9-]{1,40}$/
const MAX_BODY = 512 * 1024

function cacheControl(path) {
  // Vite content-hashes everything under /assets, so it can be cached hard.
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  // Sprites are stable per id but not hashed.
  if (path.startsWith('/sprites/')) return 'public, max-age=604800'
  // The entry point and the service worker must never be stale, or a deploy never arrives.
  return 'no-cache'
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'Save is too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Body is not JSON')
  }
}

/** The stored shape. Roster contents are validated again by the app on load. */
function validSetup(id, body) {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Expected an object')
  const { name, gen, updatedAt, deleted, state } = body
  if (typeof name !== 'string' || name.length > 60) throw new HttpError(400, 'name must be text, 60 characters at most')
  if (!Number.isInteger(gen) || gen < 1 || gen > 9) throw new HttpError(400, 'gen must be 1 to 9')
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) throw new HttpError(400, 'updatedAt must be a number')
  if (deleted !== undefined && deleted !== true) throw new HttpError(400, 'deleted must be true or absent')
  if (!deleted && (typeof state !== 'object' || state === null || Array.isArray(state))) {
    throw new HttpError(400, 'state must be an object')
  }
  return deleted ? { id, name, gen, updatedAt, deleted: true } : { id, name, gen, updatedAt, state }
}

function authorised(req, accessCode) {
  if (!accessCode) return true
  const given = Buffer.from(String(req.headers.authorization ?? ''))
  const expected = Buffer.from(`Bearer ${accessCode}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function createApp({ distDir = join(ROOT, 'dist'), dataDir = join(ROOT, '.data'), accessCode = '' } = {}) {
  const dist = resolve(distDir)
  const store = resolve(dataDir)
  /** path -> { body, gz, mtime }; the built site is small, so it is held in memory. */
  const files = new Map()

  const fileFor = (id) => join(store, `${id}.json`)

  async function readSetup(id) {
    try {
      return JSON.parse(await readFile(fileFor(id), 'utf8'))
    } catch {
      return null
    }
  }

  async function writeSetup(setup) {
    await mkdir(store, { recursive: true })
    // Write then rename, so a crash can never leave a half-written save.
    const tmp = `${fileFor(setup.id)}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(setup))
    await rename(tmp, fileFor(setup.id))
  }

  async function api(req, res, path) {
    if (path === '/api/health') return sendJson(res, 200, { ok: true })
    if (!authorised(req, accessCode)) return sendJson(res, 401, { error: 'Access code required' })

    if (path === '/api/setups') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' })
      let names = []
      try {
        names = (await readdir(store)).filter((f) => f.endsWith('.json'))
      } catch {
        // No saves yet.
      }
      const list = []
      for (const f of names) {
        const s = await readSetup(f.slice(0, -5))
        if (s) list.push({ id: s.id, name: s.name, gen: s.gen, updatedAt: s.updatedAt, ...(s.deleted ? { deleted: true } : {}) })
      }
      return sendJson(res, 200, list)
    }

    // Matched on the raw path and decoded afterwards, so an encoded "/" can't change the route.
    const match = /^\/api\/setups\/([^/]+)$/.exec(path)
    if (!match) return sendJson(res, 404, { error: 'Not found' })
    let id
    try {
      id = decodeURIComponent(match[1])
    } catch {
      id = ''
    }
    if (!SETUP_ID.test(id)) return sendJson(res, 400, { error: 'Invalid setup id' })

    if (req.method === 'GET') {
      const s = await readSetup(id)
      return s ? sendJson(res, 200, s) : sendJson(res, 404, { error: 'No such setup' })
    }

    if (req.method === 'PUT' || req.method === 'DELETE') {
      const current = await readSetup(id)
      const next =
        req.method === 'PUT'
          ? validSetup(id, await readBody(req))
          : { id, name: current?.name ?? '', gen: current?.gen ?? 9, updatedAt: Date.now(), deleted: true }
      // Last write wins; an older copy (including one racing a delete) gets the newer one back.
      if (current && current.updatedAt > next.updatedAt) return sendJson(res, 409, current)
      await writeSetup(next)
      return sendJson(res, 200, next)
    }

    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  async function loadFile(file) {
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return null
    const cached = files.get(file)
    if (cached && cached.mtime === info.mtimeMs) return cached
    const body = await readFile(file)
    const entry = { body, gz: COMPRESSIBLE.has(extname(file)) && body.length > 1024 ? gzipSync(body) : null, mtime: info.mtimeMs }
    files.set(file, entry)
    return entry
  }

  async function staticFile(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' })
    const target = resolve(dist, `.${path}`)
    // Anything resolving outside dist/ (../ tricks, encoded or not) is simply not found.
    if (target !== dist && !target.startsWith(dist + sep)) return sendJson(res, 404, { error: 'Not found' })

    let file = target === dist ? join(dist, 'index.html') : target
    let entry = await loadFile(file)
    let servedPath = path
    // Paths without an extension are app routes: hand back the app shell.
    if (!entry && !extname(path)) {
      file = join(dist, 'index.html')
      entry = await loadFile(file)
      servedPath = '/index.html'
    }
    if (!entry) return sendJson(res, 404, { error: 'Not found' })

    const useGzip = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    const body = useGzip ? entry.gz : entry.body
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': cacheControl(servedPath),
      'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff',
      ...(entry.gz ? { Vary: 'Accept-Encoding' } : {}),
      ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}),
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  return async function handle(req, res) {
    const raw = new URL(req.url ?? '/', 'http://localhost').pathname
    let path
    try {
      path = decodeURIComponent(raw)
    } catch {
      return sendJson(res, 400, { error: 'Bad path' })
    }
    try {
      if (raw === '/api' || raw.startsWith('/api/')) await api(req, res, raw)
      else await staticFile(req, res, path)
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message })
      else {
        console.error(e)
        if (!res.headersSent) sendJson(res, 500, { error: 'Server error' })
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT) || 3000
  const server = createServer(
    createApp({
      distDir: process.env.DIST_DIR || undefined,
      dataDir: process.env.DATA_DIR || undefined,
      accessCode: process.env.ACCESS_CODE ?? '',
    }),
  )
  server.listen(port, () => {
    console.log(`Hack Team Builder on http://localhost:${port}${process.env.ACCESS_CODE ? ' (access code required)' : ''}`)
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
