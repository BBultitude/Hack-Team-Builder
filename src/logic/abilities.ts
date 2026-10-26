/**
 * Defender-side ability effects. Design.md section 5 lists exactly which
 * abilities are modelled; attacker-side abilities (Mold Breaker and the
 * like) are deliberately out of scope.
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

/** Every ability this app understands, for the "ability not modelled" hint. */
export const MODELLED_ABILITIES: string[] = [
  ...Object.keys(IMMUNE),
  ...Object.keys(HALVE),
  ...REDUCE_SUPER_EFFECTIVE,
  WONDER_GUARD,
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
