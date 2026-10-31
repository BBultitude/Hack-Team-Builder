import type { GameData, Move, Nature } from '../types'
import { STAT } from '../types'
import { applyDefensiveAbility } from './abilities'
import { effectiveness } from './typeChart'

/**
 * Damage estimate with the Generation 3+ formula, as a share of the
 * defender's Hit Points. Design.md section 5.
 *
 * shortcut: no crits, weather, terrain, stat stages, burns, screens or
 * multi-hit; Gen 1-2 stats use the Gen 3 formula. Upgrade if fights still
 * surprise by more than a roll.
 */

/** One side of a fight: everything the formula needs. */
export interface Battler {
  level: number
  /** Six base stats. */
  base: number[]
  types: number[]
  ability: string
  nature: Nature | null
  /** Six values; absent means 0 (the player's untrained default). */
  evs?: number[]
  /** Six values; absent means 31. */
  ivs?: number[]
  item?: string
}

export interface Hit {
  move: Move
  /** Percent of the defender's Hit Points, lowest and highest damage roll. */
  min: number
  max: number
  /** Type multiplier after the defender's ability. */
  multiplier: number
  /** Defender ability that changed the multiplier, if any. */
  cause: string | null
}

export function statAt(b: Battler, stat: number): number {
  const base = b.base[stat] ?? 0
  const core = Math.floor(((2 * base + (b.ivs?.[stat] ?? 31) + Math.floor((b.evs?.[stat] ?? 0) / 4)) * b.level) / 100)
  if (stat === STAT.HP) return core + b.level + 10
  const nature = b.nature?.up === stat ? 1.1 : b.nature?.down === stat ? 0.9 : 1
  return Math.floor((core + 5) * nature)
}

/** Held items that raise one type's moves by 20%. */
const TYPE_ITEMS: Record<string, string> = {
  'charcoal': 'Fire', 'mystic water': 'Water', 'miracle seed': 'Grass', 'magnet': 'Electric',
  'never-melt ice': 'Ice', 'black belt': 'Fighting', 'poison barb': 'Poison', 'soft sand': 'Ground',
  'sharp beak': 'Flying', 'twisted spoon': 'Psychic', 'silver powder': 'Bug', 'hard stone': 'Rock',
  'spell tag': 'Ghost', 'dragon fang': 'Dragon', 'black glasses': 'Dark', 'metal coat': 'Steel',
  'silk scarf': 'Normal', 'fairy feather': 'Fairy',
}

function itemBoost(item: string, typeName: string, multiplier: number): number {
  const key = item.trim().toLowerCase()
  if (!key) return 1
  if (key === 'life orb') return 1.3
  if (key === 'expert belt') return multiplier > 1 ? 1.2 : 1
  if (TYPE_ITEMS[key] === typeName) return 1.2
  if (key === `${typeName.toLowerCase()} gem`) return 1.3
  return 1
}

/** Attack-stat multiplier from the attacker's item and ability. */
function attackBoost(a: Battler, physical: boolean): number {
  const item = a.item?.trim().toLowerCase() ?? ''
  const ability = a.ability.trim().toLowerCase()
  let m = 1
  if (item === (physical ? 'choice band' : 'choice specs')) m *= 1.5
  if (physical && (ability === 'huge power' || ability === 'pure power')) m *= 2
  return m
}

/** Defence-stat multiplier from the defender's item. */
function defenceBoost(d: Battler, physical: boolean, data: GameData, dexIndex?: number): number {
  const item = d.item?.trim().toLowerCase() ?? ''
  if (item === 'assault vest' && !physical) return 1.5
  if (item === 'eviolite' && dexIndex !== undefined && data.dex[dexIndex]?.ev?.length) return 1.5
  return 1
}

/** null for status and variable-power moves, which the formula can't price. */
export function estimate(
  data: GameData,
  attacker: Battler,
  defender: Battler,
  move: Move,
  defenderDex?: number,
): Hit | null {
  if (move.p <= 0) return null
  const typeName = data.chart.types[move.t] ?? ''
  const raw = effectiveness(data.chart, move.t, defender.types)
  const { multiplier, cause } = applyDefensiveAbility(raw, defender.ability, typeName)

  const physical = move.c === 'physical'
  const atk = statAt(attacker, physical ? STAT.ATTACK : STAT.SP_ATTACK) * attackBoost(attacker, physical)
  const def = statAt(defender, physical ? STAT.DEFENSE : STAT.SP_DEFENSE) * defenceBoost(defender, physical, data, defenderDex)
  const ability = attacker.ability.trim().toLowerCase()
  const power = ability === 'technician' && move.p <= 60 ? move.p * 1.5 : move.p

  const base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * atk) / def) / 50) + 2
  const stab = attacker.types.includes(move.t) ? (ability === 'adaptability' ? 2 : 1.5) : 1
  const item = itemBoost(attacker.item ?? '', typeName, multiplier)
  const roll = (r: number): number =>
    multiplier === 0 ? 0 : Math.floor(Math.floor(Math.floor(Math.floor((base * r) / 100) * stab) * multiplier) * item)

  const hp = statAt(defender, STAT.HP)
  const pct = (n: number): number => Math.round((n / hp) * 1000) / 10
  return { move, min: pct(roll(85)), max: pct(roll(100)), multiplier, cause }
}

/** The hardest-hitting of several moves, by top roll. */
export function strongest(
  data: GameData,
  attacker: Battler,
  defender: Battler,
  moves: readonly Move[],
  defenderDex?: number,
): Hit | null {
  let best: Hit | null = null
  for (const move of moves) {
    const hit = estimate(data, attacker, defender, move, defenderDex)
    if (hit && (!best || hit.max > best.max)) best = hit
  }
  return best
}
