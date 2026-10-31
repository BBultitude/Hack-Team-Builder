import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { data, lookup, dexIndex } from './testData'
import { resolveMember, entryFromDex, incomingMultiplier } from './member'
import { readFileSync } from 'node:fs'
import type { HackPack } from '../types'
import { buildLookup } from './lookup'
import { resolveOpponent } from './opponent'
import { adaptRoster, forSetup, inGen, withHack } from './setup'
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

describe('withHack (Unbound pack)', () => {
  const pack = JSON.parse(readFileSync(new URL('../../data/hacks/unbound.json', import.meta.url), 'utf8')) as HackPack
  const unbound = withHack(data, pack)
  const ub = buildLookup(unbound)
  const entry = (name: string) => unbound.dex[ub.dexByName.get(name.toLowerCase())!]!

  it('leaves vanilla alone without a pack', () => {
    expect(withHack(data, null)).toBe(data)
  })

  it("applies the hack's stats and abilities", () => {
    // Unbound buffs Cresselia's defences and gives Weedle Technician as its hidden ability.
    expect(entry('Cresselia').s).toEqual([120, 70, 120, 75, 130, 85])
    expect(entry('Weedle').hab).toEqual(['Technician'])
  })

  it('adds forms the vanilla dex lacks, keeping vanilla indices', () => {
    expect(unbound.dex.slice(0, data.dex.length).map((d) => d.n)).toEqual(data.dex.map((d) => d.n))
    const mega = entry('Garchomp (Mega)')
    expect(mega.s[1]).toBe(170)
    expect(mega.id).toBe(dexOf(data, 'Garchomp').id)
    expect(unbound.learnsets.length).toBe(unbound.dex.length)
  })

  it('adds level-up moves the hack teaches', () => {
    const needleArm = ub.moveByName.get('needle arm')!
    expect(unbound.learnsets[ub.dexByName.get('beedrill')!]).toContain(needleArm)
    expect(data.learnsets[dexIndex('Beedrill')]).not.toContain(needleArm)
  })

  it('beats the generation history for changed types', () => {
    const changed = Object.entries(pack.dex).find(([, c]) => c.t && !c.base)
    if (!changed) return
    const [name, change] = changed
    expect(forSetup(unbound, 8).dex[ub.dexByName.get(name.toLowerCase())!]!.t).toEqual(change.t)
  })

  it('lists all four difficulties in game order, with Vanilla on the Difficult teams', () => {
    expect(pack.difficulties!.map((d) => d.label)).toEqual(['Vanilla', 'Difficult', 'Expert', 'Insane'])
    const vanilla = pack.difficulties!.find((d) => d.id === 'vanilla')!
    expect(pack.trainers![vanilla.sets]!.find((t) => t.name === 'Leader Mirskle')).toBeDefined()
  })

  it("keeps Unbound's regional dex order, every name resolvable", () => {
    expect(pack.regional![0]).toBe('Snorunt')
    expect(pack.regional!.every((n) => ub.dexByName.has(n.toLowerCase()))).toBe(true)
  })

  it('maps where-to-find text to dex entries, so Look For can tell what Unbound has', () => {
    expect(unbound.obtain?.[ub.dexByName.get('caterpie')!]).toMatch(/Grim Woods/)
    expect(Object.keys(unbound.obtain!).length).toBeGreaterThan(800)
  })

  it('Look For only offers what Unbound has, with where to find it', () => {
    const gen8 = forSetup(unbound, 8)
    const roster = ['Charizard', 'Blastoise'].map((n) => entryFromDex(gen8, n, ub.dexByName.get(n.toLowerCase())))
    const targets = lookFor(gen8, ub, roster, [0, 1], 40)
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) {
      expect(gen8.obtain?.[t.catchFrom]).toBeDefined()
      expect(t.where).toBe(gen8.obtain![t.catchFrom])
      if (!t.gift) expect(gen8.dex[t.catchFrom]!.cr).toBeGreaterThan(6)
    }
  })

  it('has the Insane boss teams in party order, resolvable as opponents', () => {
    const mirskle = pack.trainers!.insane!.find((t) => t.name === 'Leader Mirskle')!
    expect(mirskle.team.map((m) => m.n)).toEqual(['Floette', 'Gloom', 'Weedle', 'Comfey'])
    const weedle = mirskle.team[2]!
    const foe = resolveOpponent(unbound, ub, { name: weedle.n, ability: weedle.ab, lv: weedle.lv, mv: weedle.mv })!
    expect(foe.level).toBe(17)
    expect(foe.moves.map((m) => m.n)).toContain('Bug Bite')
  })
})
