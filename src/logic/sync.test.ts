import { describe, it, expect, beforeEach } from 'vitest'
import { loadRaw, loadSetups, saveRaw, saveSetups, stateKey, type SetupIndex } from './storage'
import { mergeIndex, setAccessCode, statusFor, syncSetups } from './sync'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
  removeItem(k: string): void { this.map.delete(k) }
}

/** In-memory stand-in for server/index.mjs with the same last-write-wins rule. */
function fakeServer(code = '') {
  const store = new Map<string, Record<string, unknown>>()
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
    if (code && auth !== `Bearer ${code}`) return reply(401, { error: 'Access code required' })
    if (url === '/api/setups') {
      return reply(200, [...store.values()].map(({ state: _s, ...meta }) => meta))
    }
    const id = url.split('/').pop()!
    if (init?.method === 'PUT') {
      const body = { id, ...JSON.parse(String(init.body)) }
      const current = store.get(id)
      if (current && (current.updatedAt as number) > body.updatedAt) return reply(409, current)
      store.set(id, body)
      return reply(200, body)
    }
    const s = store.get(id)
    return s ? reply(200, s) : reply(404, {})
  }) as typeof fetch
  return { store, fetchFn }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

const withState = (index: SetupIndex, id: string, roster: string[]) => {
  saveRaw(id, { v: 1, r: roster.map((n) => ({ n })) })
  return index
}

describe('sync', () => {
  it('pushes setups the server has never seen', async () => {
    const index = loadSetups()
    withState(index, index.active, ['Charizard'])
    const server = fakeServer()
    await syncSetups(index, server.fetchFn)
    const stored = server.store.get(index.active)!
    expect(stored.name).toBe('My game')
    expect(stored.state).toEqual({ v: 1, r: [{ n: 'Charizard' }] })
  })

  it('takes the newer copy from the server, and keeps the newer copy here', async () => {
    const index = loadSetups()
    const mine = index.list[0]!
    const server = fakeServer()
    server.store.set(mine.id, { id: mine.id, name: 'Renamed elsewhere', gen: 3, updatedAt: mine.updatedAt + 10, state: { r: [{ n: 'Gengar' }] } })
    server.store.set('other-1', { id: 'other-1', name: 'Rogue', gen: 9, updatedAt: 5, state: { r: [] } })

    const { index: next, pulled } = await syncSetups(index, server.fetchFn)
    expect(pulled.sort()).toEqual([mine.id, 'other-1'].sort())
    expect(next.list.find((s) => s.id === mine.id)!.name).toBe('Renamed elsewhere')
    expect(loadRaw(mine.id)).toEqual({ r: [{ n: 'Gengar' }] })

    // Now an edit here is newer and goes up.
    saveRaw(mine.id, { r: [{ n: 'Snorlax' }] })
    const edited = { ...next, list: next.list.map((s) => (s.id === mine.id ? { ...s, updatedAt: s.updatedAt + 10 } : s)) }
    await syncSetups(edited, server.fetchFn)
    expect(server.store.get(mine.id)!.state).toEqual({ r: [{ n: 'Snorlax' }] })
  })

  it('applies a delete from another device and moves off the deleted setup', async () => {
    const index = loadSetups()
    const keep = { id: 'keep-1', name: 'Keep', gen: 9, updatedAt: 1 }
    const both = { active: index.active, list: [...index.list, keep] }
    saveSetups(both)
    withState(both, index.active, ['Charizard'])
    const server = fakeServer()
    server.store.set(index.active, { id: index.active, name: 'My game', gen: 9, updatedAt: Date.now() + 1000, deleted: true })
    server.store.set('keep-1', { ...keep, state: {} })

    const { index: next } = await syncSetups(both, server.fetchFn)
    expect(next.list.find((s) => s.id === index.active)!.deleted).toBe(true)
    expect(localStorage.getItem(stateKey(index.active))).toBeNull()
    expect(next.active).toBe('keep-1')
  })

  it('leaves local data alone when there is no server', async () => {
    const index = loadSetups()
    withState(index, index.active, ['Charizard'])
    const offline = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    const error = await syncSetups(index, offline).catch((e) => e)
    expect(statusFor(error)).toBe('offline')
    expect(loadRaw(index.active)).toEqual({ v: 1, r: [{ n: 'Charizard' }] })

    // A static host answers /api with the HTML shell: also offline.
    const shell = (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch
    expect(statusFor(await syncSetups(index, shell).catch((e) => e))).toBe('offline')
  })

  it('reports a missing access code as locked, and works once it is set', async () => {
    const index = withState(loadSetups(), loadSetups().active, ['Charizard'])
    const server = fakeServer('pikachu')
    expect(statusFor(await syncSetups(index, server.fetchFn).catch((e) => e))).toBe('locked')
    setAccessCode('pikachu')
    await syncSetups(index, server.fetchFn)
    expect(server.store.has(index.active)).toBe(true)
  })

  it('a new device uses the server games instead of its own empty "My game"', async () => {
    const fresh = loadSetups()
    expect(fresh.list[0]!.fresh).toBe(true)
    const server = fakeServer()
    server.store.set('home-1', { id: 'home-1', name: 'My game', gen: 9, updatedAt: 5, state: { r: [{ n: 'Charizard' }] } })

    const { index, dropped } = await syncSetups(fresh, server.fetchFn)
    expect(dropped).toEqual([fresh.active])
    expect(index.list.map((s) => s.id)).toEqual(['home-1'])
    expect(index.active).toBe('home-1')
    expect(server.store.has(fresh.active)).toBe(false)
    expect(mergeIndex(fresh, index, dropped).list.map((s) => s.id)).toEqual(['home-1'])
  })

  it('keeps edits made while a sync was in flight', () => {
    const current = { active: 'a', list: [{ id: 'a', name: 'Renamed now', gen: 9, updatedAt: 50 }, { id: 'b', name: 'Created now', gen: 3, updatedAt: 60 }] }
    const synced = { active: 'a', list: [{ id: 'a', name: 'Old', gen: 9, updatedAt: 40 }, { id: 'c', name: 'From server', gen: 8, updatedAt: 10 }] }
    const merged = mergeIndex(current, synced)
    expect(merged.list.map((s) => s.name).sort()).toEqual(['Created now', 'From server', 'Renamed now'])
  })
})
