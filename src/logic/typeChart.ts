import type { TypeChart } from '../types'

/**
 * Damage multiplier of an attacking type against a defending type pair,
 * before any ability is applied. Dual types multiply, so the result is one
 * of 0, 0.25, 0.5, 1, 2 or 4.
 */
export function effectiveness(
  chart: TypeChart,
  attackType: number,
  defendTypes: readonly number[],
): number {
  const row = chart.matrix[attackType]
  if (!row) return 1
  let mult = 1
  for (const d of defendTypes) {
    if (d < 0) continue
    mult *= row[d] ?? 1
  }
  return mult
}

/** Every attacking type that hits the given defending pair super-effectively. */
export function superEffectiveAgainst(chart: TypeChart, defendTypes: readonly number[]): number[] {
  const out: number[] = []
  for (let a = 0; a < chart.types.length; a++) {
    if (effectiveness(chart, a, defendTypes) > 1) out.push(a)
  }
  return out
}

/** "double damage (x2)" and friends, for the plain-English explanations. */
export function describeMultiplier(mult: number): string {
  if (mult === 0) return 'no damage (immune)'
  if (mult >= 4) return `quadruple damage (x${mult})`
  if (mult > 1) return `double damage (x${mult})`
  if (mult === 1) return 'normal damage (x1)'
  if (mult <= 0.25) return `quarter damage (x${mult})`
  return `half damage (x${mult})`
}
