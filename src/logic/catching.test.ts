import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { data, dexIndex } from './testData'
import { MIN_BEST_CASE_CHANCE, ballsFor, catchChance, catchPlan, catchSource, isEvolveOnly, isGift, needsMasterBall, throwChance } from './catching'

function own(name: string, mv: string[] = ['', '', '', '']): RosterEntry {
  const d = dexIndex(name)
  const e = data.dex[d]!
  return { n: e.n, a: e.t[0]!, b: e.t[1] ?? -1, ab: '', nt: 0, mv, st: null, d }
}

describe('catch odds', () => {
  it('is certain at a modified rate of 255 and impossible at 0', () => {
    expect(throwChance(255)).toBe(1)
    expect(throwChance(0)).toBe(0)
  })

  it('matches the Generation 3-4 formula for a capture rate 45 target', () => {
    // a = 45 x 2 (Ultra Ball) x 2.5 (asleep) at ~1 HP = 225.
    const b = 1048560 / Math.sqrt(Math.sqrt(16711680 / 225))
    expect(catchChance(45, 2, 2.5, 0)).toBeCloseTo((b / 65536) ** 4, 10)
  })

  it('is lower at full health than at 1 HP', () => {
    expect(catchChance(45, 1, 1, 1)).toBeLessThan(catchChance(45, 1, 1, 0))
  })
})

describe('balls', () => {
  it('offers a Net Ball for Water types and a Fast Ball for fast targets', () => {
    expect(ballsFor(data, data.dex[dexIndex('Magikarp')]!, false).map((b) => b.name)).toContain('Net Ball')
    expect(ballsFor(data, data.dex[dexIndex('Jolteon')]!, false).map((b) => b.name)).toContain('Fast Ball')
    expect(ballsFor(data, data.dex[dexIndex('Snorlax')]!, false).map((b) => b.name)).not.toContain('Net Ball')
  })
})

describe('catch plan', () => {
  it('uses a known False Swipe and Spore from the roster', () => {
    const roster = [own('Breloom', ['False Swipe', 'Spore', '', ''])]
    const plan = catchPlan(data, roster, [0], dexIndex('Rattata'))!
    expect(plan.weaken).toMatchObject({ member: 'Breloom', known: true })
    expect(plan.status).toMatchObject({ move: 'Spore', effect: 'sleep', known: true })
  })

  it('never plans False Swipe on a Ghost type or Spore on a Grass type', () => {
    const roster = [own('Breloom', ['False Swipe', 'Spore', '', ''])]
    expect(catchPlan(data, roster, [0], dexIndex('Gastly'))!.weaken).toBeNull()
    expect(catchPlan(data, roster, [0], dexIndex('Oddish'))!.status?.move).not.toBe('Spore')
  })

  it('suggests teaching a move a roster member can learn', () => {
    const plan = catchPlan(data, [own('Pikachu')], [0], dexIndex('Rattata'))!
    expect(plan.status).toMatchObject({ member: 'Pikachu', move: 'Thunder Wave', known: false })
    expect(plan.steps.join(' ')).toContain('it can learn Thunder Wave')
  })

  it('does not paralyse an Electric type', () => {
    expect(catchPlan(data, [own('Pikachu')], [0], dexIndex('Voltorb'))!.status).toBeNull()
  })
})

describe('what is realistically catchable', () => {
  it('hides a catch that needs a Master Ball, keeps an ordinary one', () => {
    // Best case with an Ultra Ball (1 HP, asleep): catch rate 3 is about 5% a throw, 45 well over half.
    expect(needsMasterBall(3, 8)).toBe(true)
    expect(needsMasterBall(45, 8)).toBe(false)
    expect(catchChance(3, 2, 2.5, 0)).toBeLessThan(MIN_BEST_CASE_CHANCE)
  })

  it('reads gift, egg and evolve-only location text', () => {
    expect(isGift('Obtained as an egg randomly from the Magnolia Café Egg Lady')).toBe(true)
    expect(isGift('Grim Woods, Vivill Woods (Day)')).toBe(false)
    expect(isEvolveOnly('Evolve Ivysaur (Lv. 32)')).toBe(true)
  })

  it('without location data, follows the vanilla catchable flag and catch stage', () => {
    const fm = (n: string) => data.dex[dexIndex(n)]!.fm
    const family = data.dex.map((_, i) => i).filter((i) => data.dex[i]!.fm === fm('Charizard'))
    expect(catchSource(data, dexIndex('Charizard'), family)).toEqual({ from: dexIndex('Charmander'), gift: false })
    const mewtwo = data.dex.map((_, i) => i).filter((i) => data.dex[i]!.fm === fm('Mewtwo'))
    expect(catchSource(data, dexIndex('Mewtwo'), mewtwo)).toBeNull()
  })

  it('with location data, uses where the hack has it, catches the earliest stage, and lets gifts through', () => {
    const family = (n: string) => data.dex.map((_, i) => i).filter((i) => data.dex[i]!.fm === data.dex[dexIndex(n)]!.fm)
    const obtain = {
      [dexIndex('Bulbasaur')]: 'Obtained as an egg from the Egg Lady',
      [dexIndex('Ivysaur')]: 'Evolve Bulbasaur (Lv. 16)',
      [dexIndex('Mewtwo')]: 'Cerulean Cave',
      [dexIndex('Gible')]: 'Ruins',
    }
    const hacked = { ...data, obtain }
    // A gift egg skips the ball check; the evolve-only Ivysaur entry points back to Bulbasaur.
    expect(catchSource(hacked, dexIndex('Venusaur'), family('Venusaur'))).toMatchObject({ from: dexIndex('Bulbasaur'), gift: true })
    // Catch rate 3 and a wild encounter: realistically a Master Ball, so hidden.
    expect(catchSource(hacked, dexIndex('Mewtwo'), family('Mewtwo'))).toBeNull()
    // Not in the hack's location list at all: hidden.
    expect(catchSource(hacked, dexIndex('Charizard'), family('Charizard'))).toBeNull()
    // A hack catch rate overrides vanilla: Gible at 3 needs a Master Ball.
    const hard = { ...hacked, dex: hacked.dex.map((d, i) => (i === dexIndex('Gible') ? { ...d, cr: 3 } : d)) }
    expect(catchSource(hacked, dexIndex('Gible'), family('Gible'))).not.toBeNull()
    expect(catchSource(hard, dexIndex('Gible'), family('Gible'))).toBeNull()
  })
})
