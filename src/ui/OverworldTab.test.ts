import { describe, it, expect } from 'vitest'
import { data, lookup } from '../logic/testData'
import { addToParty } from './OverworldTab'

describe('addToParty', () => {
  const six = ['Bulbasaur', 'Charmander', 'Squirtle', 'Pikachu', 'Eevee', 'Zubat'].reduce(
    (party, n) => addToParty(data, lookup, party, n)!,
    [] as ReturnType<typeof addToParty> & object,
  )

  it('fills the party up to six', () => {
    expect(six.map((e) => e.n)).toEqual(['Bulbasaur', 'Charmander', 'Squirtle', 'Pikachu', 'Eevee', 'Zubat'])
  })

  it('asks for a slot once full, then replaces only that one', () => {
    expect(addToParty(data, lookup, six, 'Mareep')).toBeNull()
    const next = addToParty(data, lookup, six, 'Mareep', 3)!
    expect(next.map((e) => e.n)).toEqual(['Bulbasaur', 'Charmander', 'Squirtle', 'Mareep', 'Eevee', 'Zubat'])
    expect(addToParty(data, lookup, six, 'Mareep', 9)).toBeNull()
  })
})
