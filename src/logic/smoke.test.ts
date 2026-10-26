import { describe, it, expect } from 'vitest'
import { data } from './testData'

/** Guards the data generator's filter rules against silent drift. */
describe('generated data', () => {
  it('ships the expected volume', () => {
    expect(data.chart.types).toHaveLength(18)
    expect(data.chart.matrix).toHaveLength(18)
    expect(data.dex.length).toBeGreaterThan(1000)
    expect(data.natures).toHaveLength(25)
    expect(data.learnsets).toHaveLength(data.dex.length)
  })

  it('gives every entry one or two types and six stats', () => {
    for (const e of data.dex) {
      expect(e.t.length).toBeGreaterThanOrEqual(1)
      expect(e.t.length).toBeLessThanOrEqual(2)
      expect(e.s).toHaveLength(6)
      for (const t of e.t) expect(t).toBeGreaterThanOrEqual(0)
      for (const t of e.t) expect(t).toBeLessThan(18)
    }
  })

  it('keeps dex names unique, so saves can resolve by name', () => {
    expect(new Set(data.dex.map((e) => e.n)).size).toBe(data.dex.length)
  })

  it('ends with exactly 18 pseudo-moves at power 80', () => {
    const pseudo = data.moves.filter((m) => m.n.startsWith('Any ') && m.n.endsWith(' move'))
    expect(pseudo).toHaveLength(18)
    for (const m of pseudo) expect(m.p).toBe(80)
    expect(new Set(pseudo.map((m) => m.t)).size).toBe(18)
  })

  it('keeps only damaging moves', () => {
    for (const m of data.moves) {
      expect(['physical', 'special']).toContain(m.c)
      expect(m.t).toBeGreaterThanOrEqual(0)
      expect(m.t).toBeLessThan(18)
    }
  })

  it('points every learnset entry at a real move', () => {
    for (const set of data.learnsets) {
      for (const i of set) expect(data.moves[i]).toBeDefined()
    }
  })
})
