import { describe, it, expect } from 'vitest'
import { effectiveStat, role, roleOf } from './stats'
import { STAT } from '../types'
import { data } from './testData'

const nature = (name: string) => {
  const n = data.natures.find((x) => x.n === name)
  if (!n) throw new Error(`unknown nature ${name}`)
  return n
}

describe('effective stat', () => {
  it('raises the boosted stat 10% and lowers the hindered one 10%', () => {
    const adamant = nature('Adamant') // +Attack, -Special Attack
    expect(adamant.up).toBe(STAT.ATTACK)
    expect(adamant.down).toBe(STAT.SP_ATTACK)
    expect(effectiveStat(100, STAT.ATTACK, adamant)).toBeCloseTo(110)
    expect(effectiveStat(100, STAT.SP_ATTACK, adamant)).toBeCloseTo(90)
    expect(effectiveStat(100, STAT.SPEED, adamant)).toBe(100)
  })

  it('leaves every stat alone for a neutral nature', () => {
    const hardy = nature('Hardy')
    expect(hardy.up).toBeNull()
    expect(hardy.down).toBeNull()
    for (let s = 0; s < 6; s++) expect(effectiveStat(100, s, hardy)).toBe(100)
  })

  it('treats a missing nature as neutral', () => {
    expect(effectiveStat(100, STAT.ATTACK, null)).toBe(100)
  })

  it('ships exactly 25 natures', () => {
    expect(data.natures).toHaveLength(25)
    expect(data.natures.filter((n) => n.up === null)).toHaveLength(5)
  })
})

describe('role', () => {
  it('needs a 15% margin before committing to Physical or Special', () => {
    expect(role(100, 100)).toBe('Mixed')
    expect(role(115, 100)).toBe('Mixed') // exactly 1.15x is not enough
    expect(role(116, 100)).toBe('Physical')
    expect(role(100, 116)).toBe('Special')
  })

  it('reads the role off a full stat array with the nature applied', () => {
    //                HP  Atk Def SpA SpD Spe
    const stats = [100, 100, 100, 100, 100, 100]
    expect(roleOf(stats, null)).toBe('Mixed')
    // Adamant pushes Attack to 110 and Special Attack to 90: 110 > 90 * 1.15.
    expect(roleOf(stats, nature('Adamant'))).toBe('Physical')
    expect(roleOf(stats, nature('Modest'))).toBe('Special')
  })
})
