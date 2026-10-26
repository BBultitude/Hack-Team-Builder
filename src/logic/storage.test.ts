import { describe, it, expect, beforeEach } from 'vitest'
import { data, lookup, dexIndex } from './testData'
import { EMPTY_STATE, load, save, type SavedState } from './storage'

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

const round = (state: SavedState): SavedState => {
  save(state)
  return load(data, lookup)
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
    expect(load(data, lookup)).toEqual(EMPTY_STATE)
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
    localStorage.setItem('ptb2', '{not json')
    expect(load(data, lookup)).toEqual(EMPTY_STATE)
  })

  it('drops entries with no name', () => {
    localStorage.setItem('ptb2', JSON.stringify({ r: [{ n: '' }, { n: '   ' }] }))
    expect(load(data, lookup).roster).toEqual([])
  })

  it('re-resolves the dex index by name after a data regeneration', () => {
    // A stale save pointing at the wrong index must still find Charizard.
    localStorage.setItem(
      'ptb2',
      JSON.stringify({ r: [{ n: 'Charizard', a: 1, b: 9, d: 99999 }] }),
    )
    expect(load(data, lookup).roster[0]!.d).toBe(charizard)
  })

  it('falls back to a custom Pokemon when the name is unknown', () => {
    localStorage.setItem('ptb2', JSON.stringify({ r: [{ n: 'Fakemon', a: 1, b: -1, d: 42 }] }))
    const entry = load(data, lookup).roster[0]!
    expect(entry.n).toBe('Fakemon')
    expect(entry.d).toBe(-1)
  })

  it('clamps out-of-range types and natures', () => {
    localStorage.setItem(
      'ptb2',
      JSON.stringify({ r: [{ n: 'Fakemon', a: 999, b: 999, nt: 999 }] }),
    )
    const entry = load(data, lookup).roster[0]!
    expect(entry.a).toBe(0)
    expect(entry.b).toBe(-1)
    expect(entry.nt).toBe(data.natures.length - 1)
  })

  it('pads the move list to four slots', () => {
    localStorage.setItem('ptb2', JSON.stringify({ r: [{ n: 'Fakemon', mv: ['Tackle'] }] }))
    expect(load(data, lookup).roster[0]!.mv).toEqual(['Tackle', '', '', ''])
  })

  it('discards team indices that point past the roster', () => {
    localStorage.setItem('ptb2', JSON.stringify({ r: [{ n: 'Charizard' }], t: [0, 5, -1, 0] }))
    expect(load(data, lookup).team).toEqual([0])
  })

  it('caps the team at six', () => {
    const roster = Array.from({ length: 9 }, (_, i) => ({ n: `Mon ${i}` }))
    localStorage.setItem('ptb2', JSON.stringify({ r: roster, t: [0, 1, 2, 3, 4, 5, 6, 7] }))
    expect(load(data, lookup).team).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('defaults the rank scope to the team', () => {
    localStorage.setItem('ptb2', JSON.stringify({ r: [], s: 'nonsense' }))
    expect(load(data, lookup).scope).toBe('team')
  })
})
