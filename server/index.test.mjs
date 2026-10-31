import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { request } from 'node:http'
import { createApp } from './index.mjs'

/** Raw request so encoded ../ paths reach the server exactly as written. */
function call(port, method, path, { body, headers = {} } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }))
    })
    req.on('error', fail)
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body))
    else req.end()
  })
}
const json = (r) => JSON.parse(r.raw.toString('utf8'))

async function start(options) {
  const server = createServer(createApp(options))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, port: server.address().port }
}

const setup = (over = {}) => ({ name: 'Unbound', gen: 8, updatedAt: 1000, state: { v: 1, r: [] }, ...over })

let dist, data, app
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'htb-'))
  dist = join(root, 'dist')
  data = join(root, 'data')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await mkdir(join(dist, 'sprites'), { recursive: true })
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Hack Team Builder</title>' + ' '.repeat(2000))
  await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
  await writeFile(join(dist, 'sprites', '6.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(root, 'secret.txt'), 'outside dist')
  app = await start({ distDir: dist, dataDir: data })
})
afterAll(() => app.server.close())

describe('static site', () => {
  it('caches hashed assets forever and the entry point never', async () => {
    const asset = await call(app.port, 'GET', '/assets/app-abc123.js')
    expect(asset.status).toBe(200)
    expect(asset.headers['cache-control']).toContain('immutable')
    expect(asset.headers['content-type']).toContain('javascript')
    const index = await call(app.port, 'GET', '/')
    expect(index.headers['cache-control']).toBe('no-cache')
    const sprite = await call(app.port, 'GET', '/sprites/6.png')
    expect(sprite.headers['cache-control']).toBe('public, max-age=604800')
  })

  it('falls back to the app shell for routes, but not for missing files', async () => {
    expect((await call(app.port, 'GET', '/opponent')).raw.toString()).toContain('Hack Team Builder')
    expect((await call(app.port, 'GET', '/sprites/99999.png')).status).toBe(404)
    expect((await call(app.port, 'GET', '/assets/missing.js')).status).toBe(404)
  })

  it('never serves files outside dist', async () => {
    for (const path of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const r = await call(app.port, 'GET', path)
      expect(r.raw.toString()).not.toContain('outside dist')
    }
  })

  it('gzips text when the browser accepts it', async () => {
    const r = await call(app.port, 'GET', '/index.html', { headers: { 'accept-encoding': 'gzip, br' } })
    expect(r.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(r.raw).toString()).toContain('Hack Team Builder')
    const plain = await call(app.port, 'GET', '/index.html')
    expect(plain.headers['content-encoding']).toBeUndefined()
  })
})

describe('setups API', () => {
  it('stores and returns a setup, and lists it without its state', async () => {
    expect((await call(app.port, 'PUT', '/api/setups/game-1', { body: setup() })).status).toBe(200)
    const got = json(await call(app.port, 'GET', '/api/setups/game-1'))
    expect(got).toMatchObject({ id: 'game-1', name: 'Unbound', gen: 8, state: { v: 1, r: [] } })
    const list = json(await call(app.port, 'GET', '/api/setups'))
    expect(list).toContainEqual({ id: 'game-1', name: 'Unbound', gen: 8, updatedAt: 1000 })
    expect(await readdir(data)).toEqual(['game-1.json'])
  })

  it('keeps the newer copy and hands it back to an older writer', async () => {
    await call(app.port, 'PUT', '/api/setups/game-2', { body: setup({ updatedAt: 2000, name: 'New' }) })
    const stale = await call(app.port, 'PUT', '/api/setups/game-2', { body: setup({ updatedAt: 1500, name: 'Old' }) })
    expect(stale.status).toBe(409)
    expect(json(stale).name).toBe('New')
  })

  it('a delete leaves a tombstone that an older copy cannot overwrite', async () => {
    await call(app.port, 'PUT', '/api/setups/game-3', { body: setup({ updatedAt: 1000 }) })
    expect((await call(app.port, 'DELETE', '/api/setups/game-3')).status).toBe(200)
    const revive = await call(app.port, 'PUT', '/api/setups/game-3', { body: setup({ updatedAt: 1001 }) })
    expect(revive.status).toBe(409)
    expect(json(revive).deleted).toBe(true)
    expect(json(await call(app.port, 'GET', '/api/setups')).find((s) => s.id === 'game-3').deleted).toBe(true)
  })

  it('rejects bad ids, bad fields and oversized saves', async () => {
    expect((await call(app.port, 'GET', '/api/setups/..%2f..%2fetc')).status).toBe(400)
    expect((await call(app.port, 'PUT', '/api/setups/Bad_ID', { body: setup() })).status).toBe(400)
    expect((await call(app.port, 'PUT', '/api/setups/game-4', { body: setup({ gen: 12 }) })).status).toBe(400)
    expect((await call(app.port, 'PUT', '/api/setups/game-4', { body: setup({ state: 'nope' }) })).status).toBe(400)
    expect((await call(app.port, 'PUT', '/api/setups/game-4', { body: '{not json' })).status).toBe(400)
    const huge = setup({ state: { r: 'x'.repeat(600 * 1024) } })
    expect((await call(app.port, 'PUT', '/api/setups/game-4', { body: huge })).status).toBe(413)
  })
})

describe('access code', () => {
  it('requires the code for setups but not for the health check', async () => {
    const locked = await start({ distDir: dist, dataDir: join(data, 'locked'), accessCode: 'pikachu' })
    try {
      expect((await call(locked.port, 'GET', '/api/health')).status).toBe(200)
      expect((await call(locked.port, 'GET', '/api/setups')).status).toBe(401)
      expect((await call(locked.port, 'GET', '/api/setups', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
      expect((await call(locked.port, 'GET', '/api/setups', { headers: { authorization: 'Bearer pikachu' } })).status).toBe(200)
      // The site itself stays reachable so the app can ask for the code.
      expect((await call(locked.port, 'GET', '/')).status).toBe(200)
    } finally {
      locked.server.close()
    }
  })
})
