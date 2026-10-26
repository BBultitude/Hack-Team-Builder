import { describe, it, expect } from 'vitest'
import type { RosterEntry } from '../types'
import { data, lookup, typeIndex, dexIndex } from './testData'
import { incomingMultiplier, resolveMember } from './member'
import { analyseTeam, autoBuild, learnableFixes, suggestAdditions, MAX_TEAM } from './team'

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

describe('learnable fixes', () => {
  it('suggests a move that would cover a gap, ranked with the type bonus', () => {
    const team = [member(own('Charizard'))]
    const a = analyseTeam(data, team)
    const fixes = learnableFixes(data, team, a.uncovered)

    expect(fixes.length).toBeGreaterThan(0)
    for (const fix of fixes) {
      // Every suggestion must actually beat the type it was chosen for.
      expect(data.chart.matrix[fix.move.t]![fix.type]!).toBeGreaterThan(1)
      expect(fix.rating).toBe(fix.move.p * (fix.stab ? 1.5 : 1))
    }
  })

  it('skips custom Pokemon, which have no vanilla learnset', () => {
    const custom = member({ ...own('Charizard'), d: -1 })
    expect(learnableFixes(data, [custom], [t('Water')])).toEqual([])
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
