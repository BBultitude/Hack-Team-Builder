import { describe, it, expect } from 'vitest'
import { data, lookup, dexIndex } from './testData'
import { dexList, hasEdits, ownership } from './checklist'
import { entryFromDex, evolve } from './member'
import { forSetup } from './setup'

const fresh = (name: string) => entryFromDex(data, name, dexIndex(name))

describe('dex checklist', () => {
  it('lists the National Dex in number order, without battle-only forms', () => {
    const list = dexList(data, lookup, 'national')
    expect(data.dex[list[0]!]!.n).toBe('Bulbasaur')
    expect(list.some((i) => /\(Mega/.test(data.dex[i]!.n))).toBe(false)
    expect(list).toContain(dexIndex('Ninetales (Alola)'))
  })

  it('respects the generation cap', () => {
    const gen3 = forSetup(data, 3)
    const list = dexList(gen3, lookup, 'national')
    expect(list).toContain(dexIndex('Rayquaza'))
    expect(list).not.toContain(dexIndex('Lucario'))
  })

  it("uses a hack's regional order when asked, and falls back to National without one", () => {
    const regional = ['Snorunt', 'Glalie', 'Froslass']
    expect(dexList(data, lookup, 'regional', regional).map((i) => data.dex[i]!.n)).toEqual(regional)
    expect(dexList(data, lookup, 'regional')).toEqual(dexList(data, lookup, 'national'))
  })

  it('ticks by ownership, and evolving moves the tick to the evolution', () => {
    const roster = [fresh('Charmander'), fresh('Pikachu'), fresh('Pikachu')]
    expect(ownership(roster).get(dexIndex('Pikachu'))).toEqual([1, 2])
    const evolved = [evolve(data, roster[0]!, dexIndex('Charmeleon')), ...roster.slice(1)]
    const owned = ownership(evolved)
    expect(owned.has(dexIndex('Charmander'))).toBe(false)
    expect(owned.get(dexIndex('Charmeleon'))).toEqual([0])
  })

  it('treats a fresh catch as unedited, and any change as edited', () => {
    expect(hasEdits(data, fresh('Pikachu'))).toBe(false)
    expect(hasEdits(data, { ...fresh('Pikachu'), lv: 30 })).toBe(true)
    expect(hasEdits(data, { ...fresh('Pikachu'), mv: ['Thunderbolt', '', '', ''] })).toBe(true)
    // Saves from before levels have no lv; that is the default, not an edit.
    const { lv: _lv, ...old } = fresh('Pikachu')
    expect(hasEdits(data, old)).toBe(false)
  })
})
