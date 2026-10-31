import { describe, it, expect, beforeEach } from 'vitest'
import { data, lookup, dexIndex } from './testData'
import {
  EMPTY_STATE,
  liveSetups,
  load,
  loadSetups,
  newSetupId,
  removeState,
  save,
  saveSetups,
  stateKey,
  SETUP_ID,
  type SavedState,
} from './storage'

/** Minimal localStorage stand-in; vitest runs these in Node. */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

const ID = 'test-setup'
const KEY = stateKey(ID)

const round = (state: SavedState): SavedState => {
  save(ID, state)
  return load(data, lookup, ID)
}

const charizard = dexIndex('Charizard')

const sample: SavedState = {
  roster: [
    {
      n: 'Charizard',
      a: data.dex[charizard]!.t[0]!,
      b: data.dex[charizard]!.t[1]!,
      ab: 'Blaze',
      nt: 3,
      mv: ['Flamethrower', 'Air Slash', '', ''],
      st: null,
      d: charizard,
    },
  ],
  team: [0],
  opponent: { name: 'Gengar', ability: 'Levitate' },
  scope: 'all',
}

describe('storage', () => {
  it('returns the empty state when nothing is saved', () => {
    expect(load(data, lookup, ID)).toEqual(EMPTY_STATE)
  })

  it('survives a round trip unchanged', () => {
    expect(round(sample)).toEqual(sample)
  })

  it('keeps stat overrides', () => {
    const withStats: SavedState = {
      ...sample,
      roster: [{ ...sample.roster[0]!, st: [80, 90, 80, 110, 90, 100] }],
    }
    expect(round(withStats).roster[0]!.st).toEqual([80, 90, 80, 110, 90, 100])
  })

  it('ignores corrupt JSON rather than throwing', () => {
    localStorage.setItem(KEY, '{not json')
    expect(load(data, lookup, ID)).toEqual(EMPTY_STATE)
  })

  it('drops entries with no name', () => {
    localStorage.setItem(KEY, JSON.stringify({ r: [{ n: '' }, { n: '   ' }] }))
    expect(load(data, lookup, ID).roster).toEqual([])
  })

  it('re-resolves the dex index by name after a data regeneration', () => {
    // A stale save pointing at the wrong index must still find Charizard.
    localStorage.setItem(KEY,
      JSON.stringify({ r: [{ n: 'Charizard', a: 1, b: 9, d: 99999 }] }),
    )
    expect(load(data, lookup, ID).roster[0]!.d).toBe(charizard)
  })

  it('falls back to a custom Pokemon when the name is unknown', () => {
    localStorage.setItem(KEY, JSON.stringify({ r: [{ n: 'Fakemon', a: 1, b: -1, d: 42 }] }))
    const entry = load(data, lookup, ID).roster[0]!
    expect(entry.n).toBe('Fakemon')
    expect(entry.d).toBe(-1)
  })

  it('clamps out-of-range types and natures', () => {
    localStorage.setItem(KEY,
      JSON.stringify({ r: [{ n: 'Fakemon', a: 999, b: 999, nt: 999 }] }),
    )
    const entry = load(data, lookup, ID).roster[0]!
    expect(entry.a).toBe(0)
    expect(entry.b).toBe(-1)
    expect(entry.nt).toBe(data.natures.length - 1)
  })

  it('pads the move list to four slots', () => {
    localStorage.setItem(KEY, JSON.stringify({ r: [{ n: 'Fakemon', mv: ['Tackle'] }] }))
    expect(load(data, lookup, ID).roster[0]!.mv).toEqual(['Tackle', '', '', ''])
  })

  it('discards team indices that point past the roster', () => {
    localStorage.setItem(KEY, JSON.stringify({ r: [{ n: 'Charizard' }], t: [0, 5, -1, 0] }))
    expect(load(data, lookup, ID).team).toEqual([0])
  })

  it('caps the team at six', () => {
    const roster = Array.from({ length: 9 }, (_, i) => ({ n: `Mon ${i}` }))
    localStorage.setItem(KEY, JSON.stringify({ r: roster, t: [0, 1, 2, 3, 4, 5, 6, 7] }))
    expect(load(data, lookup, ID).team).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('defaults the rank scope to the team', () => {
    localStorage.setItem(KEY, JSON.stringify({ r: [], s: 'nonsense' }))
    expect(load(data, lookup, ID).scope).toBe('team')
  })
})

describe('game setups', () => {
  it('creates "My game" on first run', () => {
    const index = loadSetups()
    expect(liveSetups(index)).toHaveLength(1)
    expect(index.list[0]!.name).toBe('My game')
    expect(index.list[0]!.gen).toBe(9)
    expect(index.active).toBe(index.list[0]!.id)
  })

  it('migrates the old single save into the first setup and removes it', () => {
    localStorage.setItem('ptb2', JSON.stringify({ r: [{ n: 'Charizard' }], t: [0] }))
    const index = loadSetups()
    expect(load(data, lookup, index.active).roster[0]!.n).toBe('Charizard')
    expect(localStorage.getItem('ptb2')).toBeNull()
    // A second load keeps the same setup rather than creating another.
    expect(loadSetups().active).toBe(index.active)
  })

  it('keeps each setup roster separate', () => {
    const a = loadSetups()
    const b = { id: newSetupId(), name: 'Emerald', gen: 3, updatedAt: 1 }
    saveSetups({ active: b.id, list: [...a.list, b] })
    save(a.active, sample)
    save(b.id, { ...EMPTY_STATE, roster: [{ ...sample.roster[0]!, n: 'Blastoise', d: dexIndex('Blastoise') }] })
    expect(load(data, lookup, a.active).roster[0]!.n).toBe('Charizard')
    expect(load(data, lookup, b.id).roster[0]!.n).toBe('Blastoise')
    expect(loadSetups().active).toBe(b.id)
  })

  it('deleting removes the stored state, and a tombstone is never active', () => {
    const a = loadSetups()
    const b = { id: newSetupId(), name: 'Rogue', gen: 9, updatedAt: 1 }
    save(b.id, sample)
    saveSetups({ active: b.id, list: [...a.list, { ...b, deleted: true }] })
    removeState(b.id)
    expect(localStorage.getItem(stateKey(b.id))).toBeNull()
    expect(loadSetups().active).toBe(a.active)
  })

  it('makes ids the server accepts and drops invalid stored entries', () => {
    expect(SETUP_ID.test(newSetupId())).toBe(true)
    localStorage.setItem('ptb2:setups', JSON.stringify({ active: '../x', list: [{ id: '../x', name: 'bad' }, { id: 'ok-1', name: 'Good', gen: 42 }] }))
    const index = loadSetups()
    expect(index.list.map((s) => s.id)).toEqual(['ok-1'])
    expect(index.list[0]!.gen).toBe(9)
    expect(index.active).toBe('ok-1')
  })
})
