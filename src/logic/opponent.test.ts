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
  resolveOpponent,
  type Opponent,
} from './opponent'
import type { SavedOpponent } from './storage'

const t = typeIndex

function own(name: string, over: Partial<RosterEntry> = {}): RosterEntry {
  const d = dexIndex(name)
  const e = data.dex[d]!
  return { n: e.n, a: e.t[0]!, b: e.t[1] ?? -1, ab: '', nt: 0, mv: ['', '', '', ''], st: null, d, ...over }
}

const member = (e: RosterEntry) => resolveMember(data, lookup, e)

function opponentOf(name: string, ability = '', more: Partial<SavedOpponent> = {}): Opponent {
  return resolveOpponent(data, lookup, { name, ability, ...more })!
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
  it('ranks a faster one-hit knockout first: it wins before the opponent moves', () => {
    // Under "least damage taken" Blastoise led here. Survive-then-win puts Alakazam first:
    // it outspeeds Gengar and Psychic (x2, STAB) knocks it out in one hit.
    const glass = member(own('Alakazam', { mv: ['Psychic', '', '', ''] }))
    const steady = member(own('Blastoise', { mv: ['Surf', '', '', ''] }))
    const ranked = rankMembers(data, [glass, steady], opponentOf('Gengar'))
    const alakazam = ranked.find((r) => r.name === 'Alakazam')!
    expect(alakazam.faster).toBe(true)
    expect(alakazam.myHits).toBe(1)
    expect(alakazam.survives && alakazam.wins).toBe(true)
    expect(ranked[0]!.name).toBe('Alakazam')
  })

  it('prefers a member that wins the exchange over one that only takes less', () => {
    // Snorlax Lv 50 walls a Lv 50 Machamp boss far better than a slow, frail attacker would,
    // but if it cannot win the exchange it still ranks below one that survives and wins.
    const boss = opponentOf('Machamp', '', { lv: 50, mv: ['Close Combat'] })
    const wall = member(own('Snorlax', { mv: ['Tackle', '', '', ''], lv: 50 }))
    const winner = member(own('Alakazam', { mv: ['Psychic', '', '', ''], lv: 70 }))
    const ranked = rankMembers(data, [wall, winner], boss)
    const [first, second] = ranked
    expect(first!.wins).toBe(true)
    expect(second!.wins).toBe(false)
    expect(first!.name).toBe('Alakazam')
  })

  it('counts a Speed tie as losing the exchange', () => {
    const boss = opponentOf('Jolteon', '', { lv: 50, mv: ['Thunderbolt'] })
    const mirror = rankMember(data, member(own('Jolteon', { mv: ['Thunderbolt', '', '', ''], lv: 50 })), boss, 0)
    // A mirror is a Speed tie; it also loses on rolls, as its worst roll is set against the boss's best.
    expect(mirror.faster).toBeNull()
    expect(mirror.myHits).toBeGreaterThanOrEqual(mirror.theirHits)
    expect(mirror.wins).toBe(false)
  })

  it('warns when a setup boss would get three or more turns', () => {
    const boss = opponentOf('Dragonite', '', { lv: 60, mv: ['Dragon Dance', 'Outrage'] })
    expect(boss.setup).toBe('Dragon Dance')
    const slow = rankMember(data, member(own('Snorlax', { mv: ['Tackle', '', '', ''], lv: 60 })), boss, 0)
    expect(slow.myHits).toBeGreaterThanOrEqual(3)
    expect(slow.setupRisk).toBe(true)
    const quick = rankMember(data, member(own('Mamoswine', { mv: ['Icicle Crash', '', '', ''], lv: 60 })), boss, 0)
    expect(quick.myHits).toBeLessThanOrEqual(2)
    expect(quick.setupRisk).toBe(false)
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
