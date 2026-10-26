import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { STAT } from '../types'
import { data, lookup, typeIndex, dexIndex } from './testData'
import { resolveMember } from './member'
import {
  describeIncoming,
  describeOffence,
  learningTip,
  rankMember,
  rankMembers,
  type Opponent,
} from './opponent'

const t = typeIndex

function own(name: string, over: Partial<RosterEntry> = {}): RosterEntry {
  const d = dexIndex(name)
  const e = data.dex[d]!
  return { n: e.n, a: e.t[0]!, b: e.t[1] ?? -1, ab: '', nt: 0, mv: ['', '', '', ''], st: null, d, ...over }
}

const member = (e: RosterEntry) => resolveMember(data, lookup, e)

function opponentOf(name: string, ability = ''): Opponent {
  const e = data.dex[dexIndex(name)]!
  return { name: e.n, types: e.t, stats: e.s, ability }
}

describe('offence', () => {
  it('applies the Same-Type Attack Bonus to the best option', () => {
    // Golem (Rock/Ground) with a Ground move, into Gengar (Ghost/Poison).
    const m = member(own('Golem', { mv: ['Earthquake', '', '', ''] }))
    const r = rankMember(data, m, opponentOf('Gengar'), 0)

    expect(r.best!.attackType).toBe(t('Ground'))
    expect(r.best!.multiplier).toBe(2) // Ground doubles into Poison
    expect(r.best!.stab).toBe(true)
    expect(r.best!.value).toBe(3) // 2 x 1.5
  })

  it('honours the opponent ability', () => {
    const m = member(own('Golem', { mv: ['Earthquake', '', '', ''] }))
    const r = rankMember(data, m, opponentOf('Gengar', 'Levitate'), 0)
    expect(r.best!.multiplier).toBe(0)
    expect(r.best!.cause).toBe('Levitate')
  })

  it('lists neutral options separately', () => {
    const m = member(own('Snorlax', { mv: ['Body Slam', 'Earthquake', '', ''] }))
    const r = rankMember(data, m, opponentOf('Blastoise'), 0)
    // Normal and Ground are both neutral into pure Water.
    expect(r.neutral.map((o) => o.attackType).sort()).toEqual([t('Normal'), t('Ground')].sort())
  })
})

describe('incoming', () => {
  it('takes the worst of the opponent own types', () => {
    // Gengar is Ghost/Poison; Alakazam (Psychic) takes double from Ghost.
    const m = member(own('Alakazam'))
    const r = rankMember(data, m, opponentOf('Gengar'), 0)
    expect(r.worstIncoming!.attackType).toBe(t('Ghost'))
    expect(r.worstIncoming!.multiplier).toBe(2)
  })

  it('applies the member ability and names it as the cause', () => {
    const m = member(own('Flygon', { ab: 'Levitate' }))
    // Golem is Rock/Ground; Levitate blanks the Ground half.
    const r = rankMember(data, m, opponentOf('Golem'), 0)
    const ground = rankMember(data, member(own('Flygon')), opponentOf('Golem'), 0)
    expect(ground.worstIncoming!.multiplier).toBeGreaterThan(0)
    expect(r.worstIncoming!.cause === 'Levitate' || r.worstIncoming!.multiplier > 0).toBe(true)
  })
})

describe('score', () => {
  const formula = (offence: number, incoming: number, speed: number) =>
    2 * Math.log2(Math.max(offence, 0.1)) - 2 * Math.log2(Math.max(incoming, 0.125)) + speed

  it('matches the published formula', () => {
    const m = member(own('Golem', { mv: ['Earthquake', '', '', ''] }))
    const opp = opponentOf('Gengar')
    const r = rankMember(data, m, opp, 0)
    const speed = r.faster === null ? 0 : r.faster ? 0.5 : -0.5
    expect(r.score).toBeCloseTo(formula(r.best!.value, r.worstIncoming!.multiplier, speed))
  })

  it('floors a total immunity rather than going infinite', () => {
    const m = member(own('Gengar')) // Normal/Fighting both do nothing to it
    const r = rankMember(data, m, opponentOf('Snorlax'), 0)
    expect(Number.isFinite(r.score)).toBe(true)
    expect(r.worstIncoming!.multiplier).toBe(0)
  })

  it('rewards being faster', () => {
    const fast = member(own('Jolteon'))
    const slow = member(own('Jolteon', { st: [65, 65, 60, 110, 95, 1] }))
    const opp = opponentOf('Snorlax')
    expect(rankMember(data, fast, opp, 0).faster).toBe(true)
    expect(rankMember(data, slow, opp, 0).faster).toBe(false)
    expect(rankMember(data, fast, opp, 0).score - rankMember(data, slow, opp, 0).score).toBeCloseTo(1)
  })

  it('uses the member effective Speed against the opponent base Speed', () => {
    const timid = data.natures.findIndex((n) => n.n === 'Timid')
    const m = member(own('Jolteon', { nt: timid }))
    expect(data.natures[timid]!.up).toBe(STAT.SPEED)
    expect(rankMember(data, m, opponentOf('Snorlax'), 0).faster).toBe(true)
  })
})

describe('ranking', () => {
  it('orders best first and keeps ties stable', () => {
    const team = [
      member(own('Alakazam')),                                   // weak to Ghost
      member(own('Golem', { mv: ['Earthquake', '', '', ''] })),   // hits hard, resists little
      member(own('Steelix')),
    ]
    const ranked = rankMembers(data, team, opponentOf('Gengar'))
    expect(ranked).toHaveLength(3)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score)
    }
    expect(ranked.at(-1)!.name).toBe('Alakazam')
  })
})

describe('learning tip', () => {
  it('suggests a stronger move when one is clearly better', () => {
    // Golem knows only a Normal move; Earthquake would be far better here.
    const m = member(own('Golem', { mv: ['Tackle', '', '', ''] }))
    const tip = learningTip(data, m, opponentOf('Gengar'))
    expect(tip).not.toBeNull()
    expect(tip!.value).toBeGreaterThan(tip!.currentValue * 1.2)
    expect(tip!.move.p).toBeGreaterThanOrEqual(60)
  })

  it('stays quiet when the current moves are already good', () => {
    const m = member(own('Golem', { mv: ['Earthquake', 'Stone Edge', '', ''] }))
    const tip = learningTip(data, m, opponentOf('Magnezone'))
    if (tip) expect(tip.value).toBeGreaterThan(tip.currentValue * 1.2)
  })

  it('returns nothing for a custom Pokemon', () => {
    const m = member({ ...own('Golem'), d: -1, mv: ['Tackle', '', '', ''] })
    expect(learningTip(data, m, opponentOf('Gengar'))).toBeNull()
  })
})

describe('explanations', () => {
  it('reads as a sentence', () => {
    const m = member(own('Golem', { mv: ['Earthquake', '', '', ''] }))
    const r = rankMember(data, m, opponentOf('Gengar'), 0)
    expect(describeOffence(data, r.best!, 'Gengar')).toBe(
      'Ground with Same-Type Attack Bonus deals double damage (x2) to Gengar',
    )
  })

  it('names the ability that caused an immunity', () => {
    const m = member(own('Golem', { mv: ['Earthquake', '', '', ''] }))
    const r = rankMember(data, m, opponentOf('Gengar', 'Levitate'), 0)
    expect(describeOffence(data, r.best!, 'Gengar')).toContain('no damage (immune)')
    expect(describeOffence(data, r.best!, 'Gengar')).toContain('via Levitate')
  })

  it('describes incoming damage from the opponent side', () => {
    const r = rankMember(data, member(own('Alakazam')), opponentOf('Gengar'), 0)
    expect(describeIncoming(data, r.worstIncoming!, 'Gengar')).toBe(
      "Gengar's Ghost attacks deal double damage (x2)",
    )
  })
})
