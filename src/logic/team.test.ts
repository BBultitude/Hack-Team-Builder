import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { data, lookup, typeIndex, dexIndex } from './testData'
import { evolutionPath, evolve, incomingMultiplier, resolveMember } from './member'
import { analyseTeam, autoBuild, lookFor, recommendMoves, suggestAdditions, MAX_TEAM } from './team'

const t = typeIndex

/** Builds a roster entry from a vanilla dex name. */
function own(name: string, over: Partial<RosterEntry> = {}): RosterEntry {
  const d = dexIndex(name)
  const entry = data.dex[d]!
  return {
    n: entry.n,
    a: entry.t[0]!,
    b: entry.t[1] ?? -1,
    ab: '',
    nt: 0,
    mv: ['', '', '', ''],
    st: null,
    d,
    ...over,
  }
}

const member = (e: RosterEntry) => resolveMember(data, lookup, e)

describe('defensive grid', () => {
  it('scores a single weakness at -1 and a resistance at +1', () => {
    // Charizard (Fire/Flying) with no ability.
    const m = [member(own('Charizard'))]
    const { grid } = analyseTeam(data, m)

    const electric = grid[t('Electric')]!
    expect(electric.weak).toBe(1)
    expect(electric.score).toBe(-1)

    const rock = grid[t('Rock')]! // x4
    expect(rock.weak).toBe(2)
    expect(rock.score).toBe(-2)

    const grass = grid[t('Grass')]! // x0.25
    expect(grass.resist).toBe(1)
    expect(grass.score).toBe(1)

    const ground = grid[t('Ground')]! // immune via Flying typing
    expect(ground.resist).toBe(1)
    expect(ground.score).toBe(1.5)
  })

  it('reports the multiplier against each member, in team order', () => {
    const team = [member(own('Charizard')), member(own('Gengar')), member(own('Snorlax'))]
    const { grid } = analyseTeam(data, team)

    for (const row of grid) {
      expect(row.cells).toHaveLength(team.length)
      team.forEach((m, i) => {
        expect(row.cells[i]).toBe(incomingMultiplier(data, m, row.type).multiplier)
      })
    }

    // Spot checks against the rendered grid.
    expect(grid[t('Rock')]!.cells[0]).toBe(4)      // Charizard, Fire/Flying
    expect(grid[t('Normal')]!.cells[1]).toBe(0)    // Gengar is Ghost
    expect(grid[t('Fighting')]!.cells[2]).toBe(2)  // Snorlax is Normal
  })

  it('reflects abilities in the reported multipliers', () => {
    const plain = analyseTeam(data, [member(own('Gengar'))])
    const levitating = analyseTeam(data, [member(own('Gengar', { ab: 'Levitate' }))])
    expect(plain.grid[t('Ground')]!.cells[0]).toBe(2)
    expect(levitating.grid[t('Ground')]!.cells[0]).toBe(0)
  })

  it('has no cells when the team is empty', () => {
    for (const row of analyseTeam(data, []).grid) expect(row.cells).toEqual([])
  })

  it('applies the member ability before scoring', () => {
    const withoutAbility = analyseTeam(data, [member(own('Gengar'))])
    const withLevitate = analyseTeam(data, [member(own('Gengar', { ab: 'Levitate' }))])

    // Ghost/Poison takes double from Ground; Levitate makes it an immunity.
    expect(withoutAbility.grid[t('Ground')]!.score).toBe(-1)
    expect(withLevitate.grid[t('Ground')]!.score).toBe(1.5)
  })

  it('adds the stacked-weakness penalty at three weaknesses', () => {
    // Three Water types all weak to Electric, none resisting it.
    const team = [member(own('Vaporeon')), member(own('Lapras')), member(own('Blastoise'))]
    const electric = analyseTeam(data, team).grid[t('Electric')]!
    expect(electric.weak).toBe(3)
    expect(electric.resist).toBe(0)
    expect(electric.score).toBe(-3 - 2) // three singles, plus the -2 penalty
  })

  it('withholds the penalty when resistances match the weaknesses', () => {
    // Two weak to Electric, two resisting it.
    const team = [
      member(own('Vaporeon')),
      member(own('Lapras')),
      member(own('Jolteon')),
      member(own('Raichu')),
    ]
    const electric = analyseTeam(data, team).grid[t('Electric')]!
    expect(electric.weak).toBe(2)
    expect(electric.resist).toBe(2)
    expect(electric.score).toBe(-2 + 2) // no penalty: weak is not greater than resist
  })
})

describe('offensive coverage', () => {
  it('falls back to the member own types when no moves are entered', () => {
    const m = member(own('Charizard'))
    expect(m.assumedFromTypes).toBe(true)
    expect(m.attackTypes).toEqual([t('Fire'), t('Flying')])
  })

  it('uses the entered moves instead once they are set', () => {
    const m = member(own('Charizard', { mv: ['Earthquake', 'Surf', '', ''] }))
    expect(m.assumedFromTypes).toBe(false)
    expect(m.attackTypes.sort()).toEqual([t('Water'), t('Ground')].sort())
  })

  it('counts each covered type once and lists the rest as uncovered', () => {
    const a = analyseTeam(data, [member(own('Charizard'))])
    // Fire hits Grass, Ice, Bug, Steel; Flying hits Grass, Fighting, Bug.
    expect(a.covered.map((i) => data.chart.types[i]).sort()).toEqual(
      ['Bug', 'Fighting', 'Grass', 'Ice', 'Steel'].sort(),
    )
    expect(a.covered.length + a.uncovered.length).toBe(18)
  })

  it('weights coverage at 1.5 on top of the defensive score', () => {
    const team = [member(own('Charizard')), member(own('Gengar'))]
    const a = analyseTeam(data, team)
    expect(a.score).toBeCloseTo(a.defensiveScore + 1.5 * a.covered.length)
  })
})

describe('team reporting', () => {
  it('flags types nothing on the team resists', () => {
    const a = analyseTeam(data, [member(own('Charizard'))])
    const exposed = a.exposed.map((i) => data.chart.types[i])
    expect(exposed).toContain('Rock')
    expect(exposed).toContain('Electric')
    expect(exposed).not.toContain('Grass') // resisted
  })

  it('counts physical, special and mixed attackers', () => {
    const a = analyseTeam(data, [member(own('Machamp')), member(own('Alakazam'))])
    expect(a.roles.physical).toBe(1)
    expect(a.roles.special).toBe(1)
  })

  it('names members with no ability set', () => {
    const a = analyseTeam(data, [member(own('Charizard')), member(own('Gengar', { ab: 'Levitate' }))])
    expect(a.membersMissingAbility).toEqual(['Charizard'])
  })
})

describe('recommended moves', () => {
  it('picks four moves of different types, Same-Type Attack Bonus first', () => {
    const [recs] = recommendMoves(data, [member(own('Charizard'))])
    expect(recs).toHaveLength(4)
    expect(new Set(recs!.map((r) => r.move.t)).size).toBe(4)
    expect(recs!.some((r) => r.stab)).toBe(true)
    expect(recs!.every((r) => r.move.p > 0)).toBe(true)
  })

  it('never suggests self-KO or recharge moves', () => {
    const recs = recommendMoves(data, [member(own('Snorlax')), member(own('Electrode'))]).flatMap((r) => r ?? [])
    for (const r of recs) expect(['Explosion', 'Self-Destruct', 'Hyper Beam', 'Giga Impact']).not.toContain(r.move.n)
  })

  it('has teammates complement each other rather than repeat coverage', () => {
    const recs = recommendMoves(data, [member(own('Charizard')), member(own('Blastoise'))])
    const first = new Set(recs[0]!.flatMap((r) => r.covers))
    for (const r of recs[1]!) for (const t of r.covers) expect(first.has(t)).toBe(false)
  })

  it('returns null for custom Pokemon, which have no vanilla learnset', () => {
    expect(recommendMoves(data, [member({ ...own('Charizard'), d: -1 })])).toEqual([null])
  })
})

describe('look for', () => {
  const roster = ['Charizard', 'Gengar', 'Snorlax'].map((n) => own(n))

  it('skips owned families and anything not realistically catchable', () => {
    const out = lookFor(data, lookup, roster, [0, 1, 2], 50)
    const owned = new Set(roster.map((e) => data.dex[e.d]!.fm))
    for (const t of out) {
      expect(data.dex[t.index]!.ok).toBe(1)
      expect(owned.has(data.dex[t.index]!.fm)).toBe(false)
    }
    expect(out.map((t) => data.dex[t.index]!.n)).not.toContain('Mewtwo')
  })

  it('lists one species per family, best gain first', () => {
    const out = lookFor(data, lookup, roster, [0, 1, 2], 50)
    expect(new Set(out.map((t) => data.dex[t.index]!.fm)).size).toBe(out.length)
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.gain).toBeGreaterThanOrEqual(out[i]!.gain)
    expect(out.every((t) => t.gain > 0)).toBe(true)
  })

  it('says to catch an easier earlier stage when there is one', () => {
    const snorlax = data.dex[dexIndex('Snorlax')]!
    expect(snorlax.cf).toBe(dexIndex('Munchlax'))
    // Equal capture rates still point at the first stage: you find Squirtle, not Blastoise.
    expect(data.dex[dexIndex('Blastoise')]!.cf).toBe(dexIndex('Squirtle'))
    expect(evolutionPath(data, dexIndex('Squirtle'), dexIndex('Blastoise')).map((i) => data.dex[i]!.n))
      .toEqual(['Squirtle', 'Wartortle', 'Blastoise'])
  })
})

describe('evolve', () => {
  it('keeps nature, moves and team position, and drops stat overrides', () => {
    const before = own('Bulbasaur', { nt: 3, mv: ['Vine Whip', '', '', ''], st: [1, 1, 1, 1, 1, 1], ab: 'Overgrow' })
    const after = evolve(data, before, dexIndex('Ivysaur'))
    expect(after).toMatchObject({ n: 'Ivysaur', nt: 3, mv: ['Vine Whip', '', '', ''], st: null, ab: 'Overgrow' })
    expect(after.d).toBe(dexIndex('Ivysaur'))
  })

  it('switches to the new form ability when the old one does not carry over', () => {
    const after = evolve(data, own('Eevee', { ab: 'Run Away' }), dexIndex('Vaporeon'))
    expect(after.ab).toBe('Water Absorb')
  })

  it('keeps regional lines apart', () => {
    const names = (n: string) => (data.dex[dexIndex(n)]!.ev ?? []).map((i) => data.dex[i]!.n)
    expect(names('Vulpix')).toEqual(['Ninetales'])
    expect(names('Vulpix (Alola)')).toEqual(['Ninetales (Alola)'])
    expect(data.dex[dexIndex('Vulpix (Alola)')]!.eh).toEqual(['use an Ice Stone'])
    expect(names('Meowth (Galar)')).toEqual(['Perrserker'])
    expect(data.dex[dexIndex('Ninetales (Alola)')]!.cf).toBe(dexIndex('Vulpix (Alola)'))
    // Babies hatch from eggs; on equal odds the wild stage is the one to look for.
    expect(data.dex[dexIndex('Raichu')]!.cf).toBe(dexIndex('Pikachu'))
  })

  it('knows every Eevee evolution and how to reach it', () => {
    const eevee = data.dex[dexIndex('Eevee')]!
    expect(eevee.ev).toHaveLength(8)
    expect(eevee.eh?.[0]).toBe('use a Water Stone')
    expect(data.dex[dexIndex('Bulbasaur')]!.eh).toEqual(['level 16'])
  })
})

describe('suggestions', () => {
  it('ranks roster members by the score they would add', () => {
    const roster = [own('Charizard'), own('Gengar'), own('Blastoise')]
    const out = suggestAdditions(data, lookup, roster, [0])
    expect(out).toHaveLength(2)
    expect(out[0]!.gain).toBeGreaterThanOrEqual(out[1]!.gain)
    expect(out.map((s) => s.index).sort()).toEqual([1, 2])
  })

  it('returns nothing once the team is full', () => {
    const roster = Array.from({ length: 8 }, (_, i) => own(data.dex[i + 1]!.n))
    expect(suggestAdditions(data, lookup, roster, [0, 1, 2, 3, 4, 5])).toEqual([])
  })
})

describe('auto-build', () => {
  const bigRoster = [
    'Charizard', 'Blastoise', 'Venusaur', 'Pikachu', 'Gengar', 'Machamp',
    'Lapras', 'Snorlax', 'Dragonite', 'Alakazam',
  ].map((n) => own(n))

  it('takes the whole roster when it fits', () => {
    const roster = bigRoster.slice(0, 4)
    expect(autoBuild(data, lookup, roster)).toEqual([0, 1, 2, 3])
  })

  it('fills exactly six from a larger roster', () => {
    expect(autoBuild(data, lookup, bigRoster)).toHaveLength(MAX_TEAM)
  })

  it('is deterministic across runs', () => {
    const a = autoBuild(data, lookup, bigRoster)
    const b = autoBuild(data, lookup, bigRoster)
    expect(a).toEqual(b)
  })

  it('beats the first six taken in roster order', () => {
    const chosen = autoBuild(data, lookup, bigRoster)
    const naive = [0, 1, 2, 3, 4, 5]
    const scoreOf = (ix: number[]) =>
      analyseTeam(data, ix.map((i) => member(bigRoster[i]!))).score
    expect(scoreOf(chosen)).toBeGreaterThanOrEqual(scoreOf(naive))
  })
})
