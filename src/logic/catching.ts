import type { DexEntry, GameData, RosterEntry } from '../types'
import { STAT } from '../types'
import { evolutionPath } from './member'

/**
 * Catching advice: which ball, which roster member weakens or statuses the
 * target, and a rough per-throw chance. Uses the Generation 3-4 capture
 * formula, which hacks built on those engines follow; later games differ
 * slightly, so every figure is shown as an estimate.
 */

export type Effect = 'sleep' | 'paralysis' | 'weaken'

interface MoveRule {
  effect: Effect
  /** Powder and spore moves fail on Grass types and Overcoat. */
  powder?: boolean
  /** Sound moves fail on Soundproof. */
  sound?: boolean
  /** Types that are immune to this move outright. */
  immuneTypes?: string[]
}

/** Best first within each effect: accuracy and reliability, roughly. */
const RULES: Record<string, MoveRule> = {
  'False Swipe': { effect: 'weaken', immuneTypes: ['Ghost'] },
  Spore: { effect: 'sleep', powder: true },
  'Sleep Powder': { effect: 'sleep', powder: true },
  'Lovely Kiss': { effect: 'sleep' },
  Yawn: { effect: 'sleep' },
  Hypnosis: { effect: 'sleep' },
  'Dark Void': { effect: 'sleep' },
  Sing: { effect: 'sleep', sound: true },
  'Grass Whistle': { effect: 'sleep', sound: true },
  Glare: { effect: 'paralysis' },
  'Thunder Wave': { effect: 'paralysis', immuneTypes: ['Ground'] },
  'Stun Spore': { effect: 'paralysis', powder: true },
}

/** Abilities that stop each status outright. */
const BLOCKS: Record<Effect, string[]> = {
  sleep: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose', 'Purifying Salt'],
  paralysis: ['Limber', 'Comatose', 'Purifying Salt'],
  weaken: [],
}

/** Capture multiplier for each status; sleep was x2 before Generation 5. */
function statusBonus(effect: Effect, gen: number): number {
  if (effect === 'sleep') return gen <= 4 ? 2 : 2.5
  return effect === 'paralysis' ? 1.5 : 1
}

export interface Helper {
  member: string
  move: string
  effect: Effect
  /** True when the move is already entered; false means "can learn it". */
  known: boolean
  /** Abilities the target might have that would stop it. */
  riskyAbilities: string[]
}

export interface Ball {
  name: string
  multiplier: number
  /** When it applies; empty for always. */
  when: string
}

export interface CatchPlan {
  weaken: Helper | null
  status: Helper | null
  steps: string[]
}

/** Per-throw chance for a modified catch rate a (Generation 3-4 shake checks). */
export function throwChance(a: number): number {
  if (a <= 0) return 0
  if (a >= 255) return 1
  const b = 1048560 / Math.sqrt(Math.sqrt(16711680 / a))
  return Math.min((b / 65536) ** 4, 1)
}

/** Chance per throw; hpFraction 1 is full health, ~0 is 1 HP. */
export function catchChance(captureRate: number, ball: number, status: number, hpFraction: number): number {
  return throwChance(captureRate * ball * status * (1 - (2 / 3) * hpFraction))
}

/** Balls worth carrying for this target that exist in the setup's generation, best multiplier first. */
export function ballsFor(data: GameData, target: DexEntry, asleep: boolean): Ball[] {
  const gen = data.gen ?? 9
  const types = target.t.map((t) => data.chart.types[t])
  const balls: Ball[] = [{ name: 'Ultra Ball', multiplier: 2, when: '' }]
  if (gen >= 4) {
    balls.push({ name: 'Quick Ball', multiplier: 5, when: 'first turn only' })
    balls.push({ name: 'Dusk Ball', multiplier: 3, when: 'at night or in caves' })
  }
  if (gen >= 3) {
    balls.push({ name: 'Timer Ball', multiplier: 4, when: 'after 10 turns' })
    if (types.includes('Water') || types.includes('Bug')) balls.push({ name: 'Net Ball', multiplier: 3.5, when: '' })
  }
  // The Apricorn balls are in Gold/Silver/Crystal and from HeartGold/SoulSilver on, not Gen 3.
  if ((gen === 2 || gen >= 4) && (target.s[STAT.SPEED] ?? 0) >= 100) {
    balls.push({ name: 'Fast Ball', multiplier: 4, when: '' })
  }
  if (gen >= 5 && asleep) balls.push({ name: 'Dream Ball', multiplier: 4, when: 'while asleep, if your hack has it' })
  return balls.sort((a, b) => b.multiplier - a.multiplier)
}

function findHelper(
  data: GameData,
  roster: readonly RosterEntry[],
  team: readonly number[],
  target: DexEntry,
  effect: Effect,
): Helper | null {
  const targetTypes = target.t.map((t) => data.chart.types[t] ?? '')
  const abilities = [...target.ab, ...target.hab]
  // Team members first, then the rest of the roster.
  const order = [...team, ...roster.map((_, i) => i).filter((i) => !team.includes(i))]

  let best: { helper: Helper; rank: number } | null = null
  Object.entries(RULES).forEach(([move, rule], moveRank) => {
    if (rule.effect !== effect) return
    if (rule.immuneTypes?.some((t) => targetTypes.includes(t))) return
    if (rule.powder && targetTypes.includes('Grass')) return
    if (effect === 'paralysis' && targetTypes.includes('Electric')) return
    const blockers = [...BLOCKS[effect], ...(rule.powder ? ['Overcoat'] : []), ...(rule.sound ? ['Soundproof'] : [])]
    const risky = abilities.filter((a) => blockers.includes(a))
    if (abilities.length > 0 && risky.length === abilities.length) return

    const learners = data.catchMoves[move] ?? []
    order.forEach((ri, pos) => {
      const e = roster[ri]
      if (!e) return
      const known = e.mv.some((m) => m.toLowerCase() === move.toLowerCase())
      if (!known && !learners.includes(e.d)) return
      // Known beats learnable, then reliable beats risky, then move order, then team order.
      const rank = (known ? 0 : 1e6) + (risky.length ? 1e4 : 0) + moveRank * 100 + pos
      if (!best || rank < best.rank) {
        best = { helper: { member: e.n, move, effect, known, riskyAbilities: risky }, rank }
      }
    })
  })
  return (best as { helper: Helper } | null)?.helper ?? null
}

/** Below this per-throw chance even in the best case, a catch realistically needs a Master Ball. */
export const MIN_BEST_CASE_CHANCE = 0.1

/** Best case with an Ultra Ball: the target at 1 HP and asleep. */
export function needsMasterBall(captureRate: number, gen: number): boolean {
  return catchChance(captureRate, 2, statusBonus('sleep', gen), 0) < MIN_BEST_CASE_CHANCE
}

/** Location text for a Pokemon handed over rather than caught: eggs, gifts, trades, rewards. */
export const isGift = (where: string): boolean => /\b(egg|gift|given|receive|reward|trade|obtained)\b/i.test(where)

/** Location text that only says to evolve an earlier stage. */
export const isEvolveOnly = (where: string): boolean => /^evolve\b/i.test(where.trim())

export interface CatchSource {
  /** Dex index to go and get: the target itself or an earlier stage. */
  from: number
  /** Where the hack has it, when the setup has location data. */
  where?: string
  /** Handed over (egg, gift, trade), so no ball is needed. */
  gift: boolean
}

/**
 * How the player can get `target` in this setup, or null when they can't
 * realistically: not in the hack, above the generation cap, or a catch that
 * needs a Master Ball. `family` lists the dex indices sharing its family.
 */
export function catchSource(data: GameData, target: number, family: readonly number[]): CatchSource | null {
  const gen = data.gen ?? 9
  const dex = data.dex[target]
  if (!dex) return null
  const catchable = (from: number, gift: boolean): boolean =>
    (data.dex[from]?.g ?? 99) <= gen && (gift || !needsMasterBall(data.dex[from]?.cr ?? 0, gen))

  if (!data.obtain) {
    const from = dex.cf ?? target
    return dex.ok && catchable(from, false) ? { from, gift: false } : null
  }

  // The earliest stage the hack lets you get directly; evolution-only entries point further back.
  let best: { from: number; length: number; where: string } | null = null
  for (const x of family) {
    const where = data.obtain[x]
    if (!where || isEvolveOnly(where)) continue
    const path = evolutionPath(data, x, target)
    if (path[0] !== x || path[path.length - 1] !== target) continue
    if (!best || path.length > best.length) best = { from: x, length: path.length, where }
  }
  if (!best) return null
  const gift = isGift(best.where)
  return catchable(best.from, gift) ? { from: best.from, where: best.where, gift } : null
}

const pct = (p: number): string => `${Math.round(p * 100)}%`

export function catchPlan(
  data: GameData,
  roster: readonly RosterEntry[],
  team: readonly number[],
  targetIndex: number,
): CatchPlan | null {
  const target = data.dex[targetIndex]
  if (!target) return null

  const weaken = findHelper(data, roster, team, target, 'weaken')
  const status = findHelper(data, roster, team, target, 'sleep') ?? findHelper(data, roster, team, target, 'paralysis')
  const bonus = status ? statusBonus(status.effect, data.gen ?? 9) : 1
  const balls = ballsFor(data, target, status?.effect === 'sleep')
  const at1Hp = (b: Ball): number => catchChance(target.cr, b.multiplier, bonus, weaken ? 0 : 0.5)
  const teach = (h: Helper): string => (h.known ? '' : ` (it can learn ${h.move}; make sure it knows it)`)
  const risk = (h: Helper): string =>
    h.riskyAbilities.length ? ` Won't work if it has ${h.riskyAbilities.join(' or ')}.` : ''

  const steps: string[] = []
  const quick = balls.find((b) => b.name === 'Quick Ball')
  if (quick) {
    steps.push(`Turn 1: throw a Quick Ball (×5) — ${pct(catchChance(target.cr, quick.multiplier, 1, 1))} even at full health.`)
  }

  if (weaken) {
    steps.push(`${weaken.member} uses False Swipe until it is at 1 HP${teach(weaken)}.`)
  } else {
    const ghost = target.t.some((t) => data.chart.types[t] === 'Ghost')
    steps.push(
      (ghost ? 'False Swipe can\'t hit Ghost types' : 'Nobody you own learns False Swipe') +
        ' — wear it down with weak or not-very-effective attacks; about half health is safe.',
    )
  }

  if (status) {
    const what = status.effect === 'sleep' ? 'put it to sleep' : 'paralyse it'
    steps.push(`${status.member} uses ${status.move} to ${what} (×${bonus} catch rate)${teach(status)}.${risk(status)}`)
  } else {
    steps.push('Nothing on your roster can put it to sleep or paralyse it; a Spore, Sleep Powder or Thunder Wave user makes this much easier.')
  }

  const always = balls.filter((b) => !b.when)
  const bestAlways = always[0]!
  steps.push(`Throw ${bestAlways.name}s (×${bestAlways.multiplier}) — about ${pct(at1Hp(bestAlways))} per throw.`)
  for (const b of balls) {
    if (!b.when || b.name === 'Quick Ball' || b.multiplier <= bestAlways.multiplier) continue
    steps.push(`${b.when[0]!.toUpperCase()}${b.when.slice(1)}: ${b.name} (×${b.multiplier}) — about ${pct(at1Hp(b))}.`)
  }

  return { weaken, status, steps }
}
