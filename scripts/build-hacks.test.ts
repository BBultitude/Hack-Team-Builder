import { describe, it, expect } from 'vitest'
import { expandMacros, firstBranches, hackLearnsets, key, parseSets, rogueLegendaries, rogueVariants } from './build-hacks'

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

  const dex = [{ n: 'Zubat' }, { n: 'Golbat' }, { n: 'Mew' }]
  const ctx = () =>
    ({ dex, dexByKey: new Map(dex.map((d, i) => [key(d.n), i])), unmatched: new Set<string>() }) as unknown as Parameters<typeof rogueVariants>[0]

  it("reads Rogue's dex variants with their generation caps", () => {
    const text = [
      'const u8 sRogueDexVariantName_KANTO_RBY[] = _("Red/Blue/Yellow");',
      'const u16 sRogueDexVariant_KANTO_RBY[] = \n{\n\tSPECIES_ZUBAT,\n\tSPECIES_GOLBAT,\n\tSPECIES_NOPE,\n};',
      'const struct RoguePokedexVariant gPokedexVariants[POKEDEX_VARIANT_COUNT] = \n{',
      '\t[POKEDEX_VARIANT_KANTO_RBY] = \n\t{\n\t\t.displayName = sRogueDexVariantName_KANTO_RBY,\n\t\t.genLimit = 1,\n\t},',
      '};',
    ].join('\n')
    const c = ctx()
    expect(rogueVariants(c, text)).toEqual([{ id: 'kanto_rby', label: 'Kanto Red/Blue/Yellow', gen: 1, species: ['Zubat', 'Golbat'] }])
    expect([...(c as unknown as { unmatched: Set<string> }).unmatched]).toEqual(['SPECIES_NOPE'])
  })

  it('collects level-up, TM, tutor and egg moves per species', () => {
    const moves = [{ n: 'Wing Attack' }, { n: 'Bite' }, { n: 'Vise Grip' }, { n: 'Air Cutter' }]
    const c = {
      ...ctx(),
      moveByKey: new Map(moves.map((m) => [key(m.n), m])),
      allMoves: new Set([...moves.map((m) => key(m.n)), key('Haze')]),
    } as unknown as Parameters<typeof hackLearnsets>[0]
    const species = (constant: string) => ({ SPECIES_ZUBAT: 'Zubat', SPECIES_GOLBAT: 'Golbat' })[constant]
    const learn = hackLearnsets(
      c,
      {
        levelUp: 'static const struct LevelUpMove sZubatLevelUpLearnset[] = {\n LEVEL_UP_MOVE( 5, MOVE_BITE),\n LEVEL_UP_MOVE(9, MOVE_HAZE),\n};\n[SPECIES_ZUBAT] = sZubatLevelUpLearnset,',
        compat: ['TM40: Wing Attack\r\nZUBAT\r\nGOLBAT\r\nGOLBAT_MEGA\r\n', 'Tutor 3: Vice Grip\nZUBAT\n'],
        egg: 'egg_moves(ZUBAT,\n\tMOVE_AIRCUTTER,\n\tMOVE_NOPE),',
      },
      species,
    )
    // Haze is a status move (not in the move data): dropped quietly. The old spelling Vice Grip maps to Vise Grip.
    expect(learn.Zubat!.sort()).toEqual(['Air Cutter', 'Bite', 'Vise Grip', 'Wing Attack'])
    expect(learn.Golbat).toEqual(['Wing Attack'])
    expect([...(c as unknown as { unmatched: Set<string> }).unmatched]).toEqual(['move MOVE_NOPE'])
  })

  it("reads Rogue's legendary list", () => {
    const text = 'bool8 RoguePokedex_IsSpeciesLegendary(u16 species)\n{\n    switch(species)\n    {\n        case SPECIES_MEW:\n            return TRUE;\n    };\n    return FALSE;\n}\nbool8 Other(u16 species) { case SPECIES_ZUBAT: return TRUE; }'
    expect(rogueLegendaries(ctx(), text)).toEqual(['Mew'])
  })
})
