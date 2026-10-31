import { describe, it, expect } from 'vitest'
import type { Move, RosterEntry } from '../types'
import { STAT } from '../types'
import { data, lookup, dexIndex } from './testData'
import { type Battler, estimate, statAt } from './damage'
import { resolveMember } from './member'
import { rankMember, rankMembers, resolveOpponent } from './opponent'

const move = (name: string): Move => data.moves[lookup.moveByName.get(name.toLowerCase())!]!

function battler(name: string, level: number, more: Partial<Battler> = {}): Battler {
  const e = data.dex[dexIndex(name)]!
  return { level, base: e.s, types: e.t, ability: '', nature: null, ...more }
}

function own(name: string, lv: number, mv: string[] = []): RosterEntry {
  const d = dexIndex(name)
  const e = data.dex[d]!
  return { n: e.n, a: e.t[0]!, b: e.t[1] ?? -1, ab: '', nt: 0, mv: [...mv, '', '', '', ''].slice(0, 4), st: null, d, lv }
}

describe('stats at a level', () => {
  it('uses the Gen 3+ formula with perfect IVs and no EVs by default', () => {
    // Garchomp Attack 130 at Lv 50: floor((260 + 31) * 50 / 100) + 5 = 150.
    expect(statAt(battler('Garchomp', 50), STAT.ATTACK)).toBe(150)
    // Snorlax HP 160 at Lv 50: floor((320 + 31) * 50 / 100) + 50 + 10 = 235.
    expect(statAt(battler('Snorlax', 50), STAT.HP)).toBe(235)
  })

  it('counts EVs and the nature', () => {
    const adamant = data.natures.find((n) => n.n === 'Adamant')!
    const evs = [0, 252, 0, 0, 0, 0]
    // floor((260 + 31 + 63) * 50 / 100) + 5 = 182, times 1.1 = 200.
    expect(statAt(battler('Garchomp', 50, { evs, nature: adamant }), STAT.ATTACK)).toBe(200)
  })
})

describe('damage estimate', () => {
  it('matches a hand-worked Earthquake', () => {
    // Base: floor(floor(22 * 100 * 150 / 85) / 50) + 2 = 79.
    // Top roll 79 x 1.5 STAB = 118 of 235 HP; bottom roll 67 x 1.5 = 100 of 235.
    const hit = estimate(data, battler('Garchomp', 50), battler('Snorlax', 50), move('Earthquake'))!
    expect(hit.max).toBe(50.2)
    expect(hit.min).toBe(42.6)
  })

  it('is zero into an immunity, and null for variable-power moves', () => {
    expect(estimate(data, battler('Garchomp', 50), battler('Skarmory', 50), move('Earthquake'))!.max).toBe(0)
    expect(estimate(data, battler('Garchomp', 50), battler('Snorlax', 50), move('Seismic Toss'))).toBeNull()
  })

  it('applies a boosting item', () => {
    const plain = estimate(data, battler('Garchomp', 50), battler('Snorlax', 50), move('Earthquake'))!
    const band = estimate(data, battler('Garchomp', 50, { item: 'Choice Band' }), battler('Snorlax', 50), move('Earthquake'))!
    expect(band.max).toBeGreaterThan(plain.max * 1.4)
  })
})

describe('the reported case: neutral hits from a stronger boss', () => {
  const boss = resolveOpponent(data, lookup, { name: 'Garchomp', ability: '', lv: 60, mv: ['Earthquake', 'Dragon Claw'] })!

  it('flags a low-level member taking only neutral damage as a one-hit knockout', () => {
    const r = rankMember(data, resolveMember(data, lookup, own('Pikachu', 30, ['Thunderbolt'])), boss, 0)
    expect(r.ohkoRisk).toBe(true)
  })

  it('ranks it below a member that is hit super-effectively but survives', () => {
    const weak = resolveMember(data, lookup, own('Snorlax', 25, ['Body Slam']))
    const sturdy = resolveMember(data, lookup, own('Golem', 80, ['Stone Edge']))
    const ranked = rankMembers(data, [weak, sturdy], boss)
    expect(ranked[1]!.worstIncoming!.multiplier).toBe(1)
    expect(ranked[0]!.name).toBe('Golem')
    expect(ranked[0]!.worstIncoming!.multiplier).toBe(2)
    expect(ranked[0]!.ohkoRisk).toBe(false)
    expect(ranked[1]!.ohkoRisk).toBe(true)
  })
})

describe('coverage moves', () => {
  const skarmory = resolveMember(data, lookup, own('Skarmory', 50, ['Brave Bird']))

  it('uses a known coverage move that type-only reasoning would miss', () => {
    const boss = resolveOpponent(data, lookup, { name: 'Garchomp', ability: '', lv: 50, mv: ['Earthquake', 'Fire Fang'] })!
    const r = rankMember(data, skarmory, boss, 0)
    expect(r.takes!.move.n).toBe('Fire Fang')
    expect(data.chart.types[r.worstIncoming!.attackType]).toBe('Fire')
  })

  it('warns about learnable coverage when the moves are unknown', () => {
    const r = rankMember(data, skarmory, resolveOpponent(data, lookup, { name: 'Garchomp', ability: '' })!, 0)
    expect(r.coverage).not.toBeNull()
    expect(r.coverage!.multiplier).toBeGreaterThan(1)
  })
})
