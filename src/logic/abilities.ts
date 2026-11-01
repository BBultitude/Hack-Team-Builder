import type { Move } from '../types'

/**
 * Defender-side ability effects, plus the few attacker-side ones that steer
 * move recommendations (attackAbility). Design.md section 5 lists exactly
 * which abilities are modelled; the rest (Mold Breaker and the like) are
 * deliberately out of scope.
 */

/** Ability -> types it grants immunity to. */
const IMMUNE: Record<string, string[]> = {
  'levitate': ['Ground'],
  'earth eater': ['Ground'],
  'flash fire': ['Fire'],
  'well-baked body': ['Fire'],
  'water absorb': ['Water'],
  'storm drain': ['Water'],
  'dry skin': ['Water'],
  'volt absorb': ['Electric'],
  'lightning rod': ['Electric'],
  'motor drive': ['Electric'],
  'sap sipper': ['Grass'],
}

/** Ability -> types it halves. */
const HALVE: Record<string, string[]> = {
  'thick fat': ['Fire', 'Ice'],
  'heatproof': ['Fire'],
  'water bubble': ['Fire'],
  'purifying salt': ['Ghost'],
}

/** Abilities that cut super-effective hits to three-quarters. */
const REDUCE_SUPER_EFFECTIVE = new Set(['filter', 'solid rock', 'prism armor'])

const WONDER_GUARD = 'wonder guard'

/** Attack-stat multipliers on physical moves, shared by the damage estimate and move recommendations. */
export const PHYSICAL_BOOST: Record<string, number> = { 'huge power': 2, 'pure power': 2, 'hustle': 1.5, 'gorilla tactics': 1.5 }

/** Attacker abilities that steer move recommendations; see attackAbility. */
export const ATTACK_ABILITIES = new Set([...Object.keys(PHYSICAL_BOOST), 'technician', 'adaptability'])

/** Every ability this app understands, for the "ability not modelled" hint. */
export const MODELLED_ABILITIES: string[] = [
  ...Object.keys(IMMUNE),
  ...Object.keys(HALVE),
  ...REDUCE_SUPER_EFFECTIVE,
  WONDER_GUARD,
  ...ATTACK_ABILITIES,
]

export interface DefenceResult {
  /** Final multiplier after the ability is applied. */
  multiplier: number
  /** Ability responsible for changing the multiplier, or null. */
  cause: string | null
}

/**
 * Applies the defender's ability to a raw type multiplier.
 *
 * `attackTypeName` is the display name (e.g. "Ground") so the tables above
 * stay readable; callers pass chart.types[attackType].
 */
export function applyDefensiveAbility(
  baseMultiplier: number,
  ability: string,
  attackTypeName: string,
): DefenceResult {
  const key = ability.trim().toLowerCase()
  if (!key) return { multiplier: baseMultiplier, cause: null }

  const immuneTo = IMMUNE[key]
  if (immuneTo?.includes(attackTypeName)) {
    return { multiplier: 0, cause: ability }
  }

  if (key === WONDER_GUARD) {
    // Only super-effective hits land at all.
    return baseMultiplier > 1
      ? { multiplier: baseMultiplier, cause: null }
      : { multiplier: 0, cause: ability }
  }

  const halveFor = HALVE[key]
  if (halveFor?.includes(attackTypeName)) {
    return { multiplier: baseMultiplier * 0.5, cause: ability }
  }

  // Tested against the base multiplier: these reduce hits that are
  // super-effective before the ability, which is the in-game behaviour.
  if (REDUCE_SUPER_EFFECTIVE.has(key) && baseMultiplier > 1) {
    return { multiplier: baseMultiplier * 0.75, cause: ability }
  }

  return { multiplier: baseMultiplier, cause: null }
}

/**
 * Attacker abilities that change which attack is strongest, for move
 * recommendations. Only ones the move data can judge: flag-based boosts
 * (Iron Fist, Strong Jaw…) need move flags it doesn't have. The damage
 * estimate shares PHYSICAL_BOOST and applies Technician and Adaptability at
 * their own steps of the formula.
 */
export function attackAbility(ability: string, move: Move, stab: boolean): { factor: number; cause: string | null } {
  const key = ability.trim().toLowerCase()
  const physical = move.c === 'physical'
  const boost = physical ? PHYSICAL_BOOST[key] : undefined
  if (boost) return { factor: boost, cause: ability }
  if (key === 'technician' && move.p <= 60) return { factor: 1.5, cause: ability }
  // Adaptability raises the same-type bonus from ×1.5 to ×2.
  if (key === 'adaptability' && stab) return { factor: 2 / 1.5, cause: ability }
  return { factor: 1, cause: null }
}
