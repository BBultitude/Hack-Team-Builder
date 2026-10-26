import { describe, it, expect } from 'vitest'
import { filterOptions, scrollCorrection } from './Suggest'
import { cellGlyph } from './DefenceMatrix'

describe('scrollCorrection', () => {
  it('does not move the page when the content already fits', () => {
    expect(scrollCorrection(400, 800)).toBe(0)
    // Exactly flush, once the margin is taken off.
    expect(scrollCorrection(792, 800)).toBe(0)
  })

  it('returns only the shortfall, not the distance to the top', () => {
    expect(scrollCorrection(900, 800, 0)).toBe(100)
    expect(scrollCorrection(810, 800, 0)).toBe(10)
  })

  it('leaves the requested margin below the content', () => {
    expect(scrollCorrection(800, 800, 8)).toBe(8)
    expect(scrollCorrection(795, 800, 20)).toBe(15)
  })

  it('never returns a negative scroll', () => {
    expect(scrollCorrection(10, 800)).toBe(0)
    expect(scrollCorrection(-50, 800)).toBe(0)
  })
})

describe('filterOptions', () => {
  const options = ['Charizard', 'Charmander', 'Charmeleon', 'Chandelure', 'Scyther', 'Pichu']

  it('returns nothing for an empty query', () => {
    expect(filterOptions(options, '')).toEqual([])
    expect(filterOptions(options, '   ')).toEqual([])
  })

  it('ranks prefix matches before substring matches', () => {
    const out = filterOptions(['Alakazam', 'Kadabra', 'Kangaskhan'], 'ka')
    expect(out[0]).toBe('Kadabra')
    expect(out[1]).toBe('Kangaskhan')
    expect(out).toContain('Alakazam')
    expect(out.indexOf('Alakazam')).toBeGreaterThan(out.indexOf('Kangaskhan'))
  })

  it('is case-insensitive and ignores surrounding space', () => {
    expect(filterOptions(options, 'CHARIZ')).toEqual(['Charizard'])
    expect(filterOptions(options, '  chariz  ')).toEqual(['Charizard'])
  })

  it('caps the list at six', () => {
    const many = Array.from({ length: 50 }, (_, i) => `Mon ${i}`)
    expect(filterOptions(many, 'Mon')).toHaveLength(6)
  })

  it('finds nothing when nothing matches', () => {
    expect(filterOptions(options, 'zzzz')).toEqual([])
  })
})

describe('cellGlyph', () => {
  it('shows nothing for a neutral hit', () => {
    expect(cellGlyph(1)).toBe('')
  })

  it('uses real fraction glyphs', () => {
    expect(cellGlyph(0.5)).toBe('½')
    expect(cellGlyph(0.25)).toBe('¼')
    expect(cellGlyph(0.75)).toBe('¾')
    expect(cellGlyph(1.5)).toBe('1½')
  })

  it('shows whole multipliers plainly', () => {
    expect(cellGlyph(0)).toBe('0')
    expect(cellGlyph(2)).toBe('2')
    expect(cellGlyph(4)).toBe('4')
    // Filter and friends can produce a 3x.
    expect(cellGlyph(3)).toBe('3')
  })
})
