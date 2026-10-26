import { describe, it, expect } from 'vitest'
import { applyDefensiveAbility } from './abilities'

describe('defensive abilities', () => {
  it('leaves the multiplier alone when no ability is set', () => {
    expect(applyDefensiveAbility(2, '', 'Ground')).toEqual({ multiplier: 2, cause: null })
    expect(applyDefensiveAbility(2, '   ', 'Ground')).toEqual({ multiplier: 2, cause: null })
  })

  it('ignores abilities it does not model', () => {
    expect(applyDefensiveAbility(2, 'Blaze', 'Water')).toEqual({ multiplier: 2, cause: null })
  })

  it.each([
    ['Levitate', 'Ground'],
    ['Earth Eater', 'Ground'],
    ['Flash Fire', 'Fire'],
    ['Well-Baked Body', 'Fire'],
    ['Water Absorb', 'Water'],
    ['Storm Drain', 'Water'],
    ['Dry Skin', 'Water'],
    ['Volt Absorb', 'Electric'],
    ['Lightning Rod', 'Electric'],
    ['Motor Drive', 'Electric'],
    ['Sap Sipper', 'Grass'],
  ])('%s grants immunity to %s', (ability, type) => {
    expect(applyDefensiveAbility(2, ability, type)).toEqual({ multiplier: 0, cause: ability })
  })

  it('only grants immunity to the matching type', () => {
    expect(applyDefensiveAbility(2, 'Levitate', 'Water')).toEqual({ multiplier: 2, cause: null })
  })

  it('matches ability names case-insensitively', () => {
    expect(applyDefensiveAbility(2, 'levitate', 'Ground').multiplier).toBe(0)
    expect(applyDefensiveAbility(2, 'LEVITATE', 'Ground').multiplier).toBe(0)
  })

  it.each([
    ['Thick Fat', 'Fire'],
    ['Thick Fat', 'Ice'],
    ['Heatproof', 'Fire'],
    ['Water Bubble', 'Fire'],
    ['Purifying Salt', 'Ghost'],
  ])('%s halves %s', (ability, type) => {
    expect(applyDefensiveAbility(2, ability, type)).toEqual({ multiplier: 1, cause: ability })
    expect(applyDefensiveAbility(0.5, ability, type).multiplier).toBe(0.25)
  })

  describe('Wonder Guard', () => {
    it('lets super-effective hits through untouched', () => {
      expect(applyDefensiveAbility(2, 'Wonder Guard', 'Fire')).toEqual({
        multiplier: 2,
        cause: null,
      })
      expect(applyDefensiveAbility(4, 'Wonder Guard', 'Fire').multiplier).toBe(4)
    })

    it('blocks neutral and resisted hits entirely', () => {
      expect(applyDefensiveAbility(1, 'Wonder Guard', 'Water')).toEqual({
        multiplier: 0,
        cause: 'Wonder Guard',
      })
      expect(applyDefensiveAbility(0.5, 'Wonder Guard', 'Water').multiplier).toBe(0)
      expect(applyDefensiveAbility(0, 'Wonder Guard', 'Normal').multiplier).toBe(0)
    })
  })

  describe.each(['Filter', 'Solid Rock', 'Prism Armor'])('%s', (ability) => {
    it('cuts super-effective hits to three-quarters', () => {
      expect(applyDefensiveAbility(2, ability, 'Fire')).toEqual({ multiplier: 1.5, cause: ability })
      expect(applyDefensiveAbility(4, ability, 'Fire').multiplier).toBe(3)
    })

    it('leaves neutral and resisted hits alone', () => {
      expect(applyDefensiveAbility(1, ability, 'Fire')).toEqual({ multiplier: 1, cause: null })
      expect(applyDefensiveAbility(0.5, ability, 'Fire')).toEqual({ multiplier: 0.5, cause: null })
    })
  })
})
