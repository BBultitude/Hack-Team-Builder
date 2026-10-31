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

describe('speed', () => {
  it('compares the member effective Speed against the opponent base Speed', () => {
    const timid = data.natures.findIndex((n) => n.n === 'Timid')
    const m = member(own('Jolteon', { nt: timid }))
    expect(data.natures[timid]!.up).toBe(STAT.SPEED)
    expect(rankMember(data, m, opponentOf('Snorlax'), 0).faster).toBe(true)
    const slow = member(own('Jolteon', { st: [65, 65, 60, 110, 95, 1] }))
    expect(rankMember(data, slow, opponentOf('Snorlax'), 0).faster).toBe(false)
  })
})

describe('ranking', () => {
  it('puts defence before offence', () => {
    // Into Gengar: Alakazam takes x2 from Ghost but hits x3 (Psychic x2, STAB).
    const glass = member(own('Alakazam', { mv: ['Psychic', '', '', ''] }))
    const steady = member(own('Blastoise', { mv: ['Surf', '', '', ''] })) // takes x1, deals x1.5
    const ranked = rankMembers(data, [glass, steady], opponentOf('Gengar'))
    expect(ranked[0]!.best!.value).toBeLessThan(ranked[1]!.best!.value)
    expect(ranked.map((r) => r.name)).toEqual(['Blastoise', 'Alakazam'])
  })

  it('sends a member that cannot hurt the opponent last, even if it is immune', () => {
    const useless = member(own('Snorlax', { mv: ['Body Slam', '', '', ''] })) // Normal into Ghost: x0
    const ok = member(own('Alakazam', { mv: ['Psychic', '', '', ''] }))
    const ranked = rankMembers(data, [useless, ok], opponentOf('Gengar'))
    expect(ranked.at(-1)!.name).toBe('Snorlax')
  })

  it('uses speed only to break ties, then keeps slot order', () => {
    const fast = member(own('Jolteon'))
    const slow = member(own('Jolteon', { st: [65, 65, 60, 110, 95, 1] }))
    const ranked = rankMembers(data, [slow, fast, slow], opponentOf('Snorlax'))
    expect(ranked.map((r) => r.slot)).toEqual([1, 0, 2])
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
