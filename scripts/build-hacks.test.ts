import { describe, it, expect } from 'vitest'
import { expandMacros, firstBranches, key, parseSets } from './build-hacks'

describe('build-hacks parsers', () => {
  it('keeps the first branch of each #if', () => {
    const text = ['a', '#if P_UPDATED_STATS >= GEN_7', 'new', '#else', 'old', '#endif', 'b'].join('\n')
    expect(firstBranches(text)).toBe('a\nnew\nb')
  })

  it('expands family macros and takes the newer arm of a ternary', () => {
    const expand = expandMacros('#define TOGEPI_FAMILY_TYPE (P_UPDATED_TYPES >= GEN_6 ? TYPE_FAIRY : TYPE_NORMAL)\n')
    expect(expand('.types = { TOGEPI_FAMILY_TYPE, TYPE_FLYING },')).toBe('.types = { TYPE_FAIRY, TYPE_FLYING },')
  })

  it('reads calc set files as data, trailing commas and all', () => {
    const sets = parseSets('var SETDEX_X = {"Weedle":{"Leader A":{"level":17,"moves":["Bug Bite",],"evs":{"at":252,},},},};')
    expect(sets.Weedle!['Leader A']!.level).toBe(17)
  })

  it('normalises names from every source to one key', () => {
    expect(key('Ninetales (Alola)')).toBe(key('Ninetales-Alola'))
  })
})
