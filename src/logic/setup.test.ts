import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { data, lookup, dexIndex } from './testData'
import { resolveMember, entryFromDex, incomingMultiplier } from './member'
import { adaptRoster, forSetup, inGen } from './setup'
import { ballsFor, catchPlan } from './catching'
import { autoBuild, lookFor } from './team'
import { effectiveness } from './typeChart'

const gen3 = forSetup(data, 3)
const typeIn = (d: typeof data, name: string): number => d.chart.types.indexOf(name)
const dexOf = (d: typeof data, name: string) => d.dex[dexIndex(name)]!
const own = (d: typeof data, name: string): RosterEntry => entryFromDex(d, name, dexIndex(name))

describe('forSetup', () => {
  it('leaves Generation 9 untouched', () => {
    expect(forSetup(data, 9)).toBe(data)
  })

  it('drops the Fairy type before Generation 6 and restores the old Steel resistances', () => {
    expect(gen3.chart.types).toHaveLength(17)
    expect(gen3.chart.types).not.toContain('Fairy')
    const steel = [typeIn(gen3, 'Steel')]
    expect(effectiveness(gen3.chart, typeIn(gen3, 'Ghost'), steel)).toBe(0.5)
    expect(effectiveness(gen3.chart, typeIn(gen3, 'Dark'), steel)).toBe(0.5)
    expect(effectiveness(data.chart, typeIn(data, 'Ghost'), steel)).toBe(1)
    // Other indices keep their meaning.
    expect(gen3.chart.types.slice(0, 17)).toEqual(data.chart.types.slice(0, 17))
  })

  it('uses the types a Pokemon had back then', () => {
    expect(dexOf(gen3, 'Clefairy').t.map((t) => gen3.chart.types[t])).toEqual(['Normal'])
    expect(dexOf(gen3, 'Togekiss').t.map((t) => gen3.chart.types[t])).toEqual(['Normal', 'Flying'])
    expect(dexOf(forSetup(data, 6), 'Clefairy').t.map((t) => data.chart.types[t])).toEqual(['Fairy'])
  })

  it('uses the abilities a Pokemon had back then', () => {
    expect(dexOf(gen3, 'Gengar').ab).toEqual(['Levitate'])
    expect(dexOf(forSetup(data, 7), 'Gengar').ab).toEqual(['Cursed Body'])
    // Gengar keeps its Ground immunity in a Gen 3 setup.
    const gengar = resolveMember(gen3, lookup, own(gen3, 'Gengar'))
    expect(incomingMultiplier(gen3, gengar, typeIn(gen3, 'Ground')).multiplier).toBe(0)
  })

  it('has no hidden abilities before Generation 5 and no abilities before Generation 3', () => {
    expect(dexOf(gen3, 'Charizard').hab).toEqual([])
    expect(dexOf(forSetup(data, 5), 'Charizard').hab).toEqual(['Solar Power'])
    const gen2 = forSetup(data, 2)
    expect(dexOf(gen2, 'Gengar').ab).toEqual([])
    const m = resolveMember(gen2, lookup, { ...own(gen2, 'Gengar'), ab: 'Levitate' })
    expect(m.ability).toBe('')
  })

  it('sets the damage class by type up to Generation 3', () => {
    const move = (d: typeof data, n: string) => d.moves.find((m) => m.n === n)!
    expect(move(gen3, 'Fire Punch').c).toBe('special')
    expect(move(gen3, 'Shadow Ball').c).toBe('physical')
    expect(move(forSetup(data, 4), 'Fire Punch').c).toBe('physical')
  })

  it('caps the Pokedex, evolutions and catch targets', () => {
    expect(dexOf(gen3, 'Lucario').ok).toBeUndefined()
    expect(dexOf(gen3, 'Eevee').ev?.map((i) => gen3.dex[i]!.n).sort()).toEqual(
      ['Espeon', 'Flareon', 'Jolteon', 'Umbreon', 'Vaporeon'],
    )
    const team = [own(gen3, 'Charizard')]
    const targets = lookFor(gen3, lookup, team, [0], 200)
    expect(targets.every((t) => gen3.dex[t.index]!.g <= 3)).toBe(true)
    expect(targets.every((t) => gen3.dex[t.catchFrom]!.g <= 3)).toBe(true)
  })

  it('catches the earliest stage that exists in the generation', () => {
    // Vanilla says catch Munchlax, which arrived in Gen 4.
    expect(data.dex[dexOf(data, 'Snorlax').cf!]!.n).toBe('Munchlax')
    expect(gen3.dex[dexOf(gen3, 'Snorlax').cf!]!.n).toBe('Snorlax')
  })

  it('only keeps moves learnable in that generation or earlier', () => {
    const bulbasaur = dexIndex('Bulbasaur')
    expect(gen3.learnsets[bulbasaur]!.length).toBeGreaterThan(0)
    expect(gen3.learnsets[bulbasaur]!.length).toBeLessThan(data.learnsets[bulbasaur]!.length)
    for (const mi of gen3.learnsets[bulbasaur]!) expect(gen3.moves[mi]!.g).toBeLessThanOrEqual(3)
    expect(gen3.learnGens[bulbasaur]).toHaveLength(gen3.learnsets[bulbasaur]!.length)
  })

  it('offers only balls that exist in the generation', () => {
    const ninjask = dexOf(gen3, 'Ninjask') // Bug, Speed 160: Net and Fast Ball candidates
    const names = ballsFor(gen3, ninjask, true).map((b) => b.name)
    expect(names).toContain('Net Ball')
    expect(names).toContain('Timer Ball')
    expect(names).not.toContain('Quick Ball')
    expect(names).not.toContain('Fast Ball')
    expect(names).not.toContain('Dream Ball')
    const plan = catchPlan(gen3, [own(gen3, 'Breloom')], [0], dexIndex('Ninjask'))!
    expect(plan.steps.join(' ')).not.toContain('Quick Ball')
  })

  it('uses the x2 sleep bonus before Generation 5', () => {
    const roster = [own(gen3, 'Breloom'), own(gen3, 'Parasect')]
    roster[0]!.mv = ['Spore', '', '', '']
    const plan = catchPlan(gen3, roster, [0], dexIndex('Zigzagoon'))!
    expect(plan.steps.join(' ')).toContain('×2 catch rate')
  })
})

describe('roster across generations', () => {
  it('flags Pokemon above the cap and leaves them out of auto-build', () => {
    const roster = ['Lucario', 'Charizard', 'Blastoise', 'Venusaur', 'Gengar', 'Machamp', 'Lapras'].map((n) => own(data, n))
    expect(inGen(gen3, roster[0]!)).toBe(false)
    expect(inGen(gen3, { d: -1 })).toBe(true)
    expect(autoBuild(gen3, lookup, roster)).not.toContain(0)
  })

  it('re-derives untouched types and abilities, and keeps hand edits', () => {
    const roster = [own(data, 'Clefairy'), { ...own(data, 'Togekiss'), a: 1, b: -1 }]
    const down = adaptRoster(data, gen3, roster)
    expect(gen3.chart.types[down[0]!.a]).toBe('Normal')
    expect(down[1]!.a).toBe(1) // edited by hand: stays Fire
    const back = adaptRoster(gen3, data, down)
    expect(data.chart.types[back[0]!.a]).toBe('Fairy')

    const gengar = adaptRoster(data, gen3, [own(data, 'Gengar')])[0]!
    expect(gengar.ab).toBe('Levitate')
  })
})
