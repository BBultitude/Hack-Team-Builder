import { describe, it, expect } from 'vitest'
import { data, typeIndex, dexIndex } from './testData'
import { describeMultiplier, effectiveness, superEffectiveAgainst } from './typeChart'

const t = typeIndex
const typesOf = (name: string): number[] => data.dex[dexIndex(name)]!.t

describe('type chart', () => {
  it('has the 18 types in the order the app assumes', () => {
    expect(data.chart.types).toEqual([
      'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
      'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
      'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
    ])
  })

  it.each([
    ['Ground', 'Electric', 2],
    ['Ground', 'Flying', 0],
    ['Fighting', 'Ghost', 0],
    ['Fire', 'Water', 0.5],
    ['Dragon', 'Fairy', 0],
    ['Fairy', 'Dragon', 2],
    ['Normal', 'Normal', 1],
  ])('%s against %s is x%s', (atk, def, expected) => {
    expect(data.chart.matrix[t(atk)]![t(def)]).toBe(expected)
  })

  it('multiplies across a dual type', () => {
    expect(effectiveness(data.chart, t('Rock'), typesOf('Charizard'))).toBe(4)
    expect(effectiveness(data.chart, t('Electric'), typesOf('Gyarados'))).toBe(4)
    // Ghost/Poison: Ground is neutral into Ghost and doubles into Poison.
    expect(effectiveness(data.chart, t('Ground'), typesOf('Gengar'))).toBe(2)
    expect(effectiveness(data.chart, t('Normal'), typesOf('Gengar'))).toBe(0)
    expect(effectiveness(data.chart, t('Psychic'), typesOf('Gengar'))).toBe(2)
  })

  it('treats a typeless defender as neutral', () => {
    expect(effectiveness(data.chart, t('Fire'), [])).toBe(1)
    expect(effectiveness(data.chart, t('Fire'), [t('Grass'), -1])).toBe(2)
  })

  it('treats a quarter-resisted hit as 0.25', () => {
    // Grass resisted by both Fire and Flying.
    expect(effectiveness(data.chart, t('Grass'), typesOf('Charizard'))).toBe(0.25)
  })

  it('lists every type that threatens a defender', () => {
    const vs = superEffectiveAgainst(data.chart, typesOf('Charizard'))
    expect(vs.map((i) => data.chart.types[i]).sort()).toEqual(['Electric', 'Rock', 'Water'])
  })

  it('describes multipliers in plain English', () => {
    expect(describeMultiplier(0)).toBe('no damage (immune)')
    expect(describeMultiplier(4)).toBe('quadruple damage (x4)')
    expect(describeMultiplier(2)).toBe('double damage (x2)')
    expect(describeMultiplier(1)).toBe('normal damage (x1)')
    expect(describeMultiplier(0.5)).toBe('half damage (x0.5)')
    expect(describeMultiplier(0.25)).toBe('quarter damage (x0.25)')
  })
})
