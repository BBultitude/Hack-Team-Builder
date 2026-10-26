import type { Nature } from '../types'
import { STAT } from '../types'

/** A nature raises one stat 10% and lowers another 10%; Hit Points never change. */
export function effectiveStat(base: number, statIndex: number, nature: Nature | null): number {
  if (!nature) return base
  if (nature.up === statIndex) return base * 1.1
  if (nature.down === statIndex) return base * 0.9
  return base
}

export type Role = 'Physical' | 'Special' | 'Mixed'

/**
 * A 15% margin keeps near-even spreads out of the Physical/Special buckets,
 * where calling them either way would be misleading.
 *
 * Scaled by 100 rather than multiplying by 1.15, which is not exactly
 * representable: 100 * 1.15 is 114.99999999999999, so an exact 1.15 ratio
 * would otherwise fall on the wrong side of the boundary.
 */
export function role(attack: number, specialAttack: number): Role {
  if (attack * 100 > specialAttack * 115) return 'Physical'
  if (specialAttack * 100 > attack * 115) return 'Special'
  return 'Mixed'
}

/** Role from a full six-stat array, with the nature applied. */
export function roleOf(stats: readonly number[], nature: Nature | null): Role {
  return role(
    effectiveStat(stats[STAT.ATTACK] ?? 0, STAT.ATTACK, nature),
    effectiveStat(stats[STAT.SP_ATTACK] ?? 0, STAT.SP_ATTACK, nature),
  )
}
