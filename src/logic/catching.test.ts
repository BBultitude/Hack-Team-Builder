import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { data, dexIndex } from './testData'
import { ballsFor, catchChance, catchPlan, throwChance } from './catching'

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
