import type { GameData, Move, Nature } from '../types'
import { STAT } from '../types'
import { applyDefensiveAbility } from './abilities'
import { type Battler, type Hit, estimate, statAt, strongest } from './damage'
import type { Lookup } from './lookup'
import { type Member, hasStab, incomingMultiplier } from './member'
import type { SavedOpponent } from './storage'
import { describeMultiplier, effectiveness } from './typeChart'

/**
 * Ranks team members against a single opponent by estimated damage
 * (Design.md section 5). The opponent's own moves are used when known, from
 * a trainer's team or typed in; otherwise its learnset stands in.
 */

/** Same-Type Attack Bonus. */
const STAB = 1.5

/** Power assumed for a member with no moves entered, one move per own type. */
const GUESS_POWER = 80

/**
 * shortcut: the learnset fallback skips moves above this power (Hyper Beam,
 * Explosion), which trainers rarely carry; known moves are never filtered.
 */
const FALLBACK_MAX_POWER = 120

/** Moves that raise the user's own stats; a boss with one snowballs if left in. */
const SETUP_MOVES = new Set([
  'swords dance', 'dragon dance', 'quiver dance', 'nasty plot', 'calm mind', 'bulk up', 'shell smash',
  'shift gear', 'coil', 'agility', 'rock polish', 'belly drum', 'tail glow', 'work up', 'growth',
  'hone claws', 'iron defense', 'cosmic power', 'geomancy', 'victory dance', 'clangorous soul', 'no retreat',
])

/** Hits needed to knock out from full at this per-hit share of Hit Points. */
const hitsToKo = (percent: number): number => (percent > 0 ? Math.ceil(100 / percent) : Infinity)

export interface Opponent {
  name: string
  /** Dex index, or -1 when it is not in the dex. */
  d: number
  types: number[]
  /** Six base stats. */
  stats: number[]
  ability: string
  /** null when unknown: each member then faces it at its own level. */
  level: number | null
  /** Known moves; empty means unknown and the learnset stands in. */
  moves: Move[]
  nature: Nature | null
  evs?: number[]
  ivs?: number[]
  item: string
  trainer?: string
  /** First setup move among its known moves, if any. */
  setup: string | null
}

export interface OffenceDetail {
  attackType: number
  /** Type multiplier after the opponent's ability. */
  multiplier: number
  stab: boolean
  /** Combined value used for ranking: multiplier, times 1.5 when it is STAB. */
  value: number
  /** Opponent ability that changed the multiplier, if any. */
  cause: string | null
}

export interface IncomingDetail {
  attackType: number
  multiplier: number
  /** Member ability that changed the multiplier, if any. */
  cause: string | null
}

export interface Ranking {
  /** Index into the array of members passed in. */
  slot: number
  name: string
  best: OffenceDetail | null
  /** Attack options that land for normal damage, listed separately. */
  neutral: OffenceDetail[]
  worstIncoming: IncomingDetail | null
  /** The opponent's hardest hit on this member. */
  takes: Hit | null
  /** This member's hardest hit on the opponent. */
  deals: Hit | null
  /** True when deals came from guessed moves of the member's own types. */
  dealsGuessed: boolean
  /** With unknown opponent moves: a harder hit from outside its types that it could learn. */
  coverage: Hit | null
  /** Hits the opponent needs to knock it out: best roll, guessed coverage included. */
  theirHits: number
  /** Hits it needs to knock the opponent out: worst roll. */
  myHits: number
  /** Lives through the opponent's hardest hit, or is faster and knocks it out first. */
  survives: boolean
  /** Knocks the opponent out before it can do the same; a Speed tie counts against. */
  wins: boolean
  /** One hit can knock it out from full health. */
  ohkoRisk: boolean
  /** The opponent has a setup move and this member needs three or more hits. */
  setupRisk: boolean
  /** null when speeds are equal. */
  faster: boolean | null
}

/** A move by name; hack docs write Hidden Power with its type ("Hidden Power Fire"). Status moves aren't in the data. */
function moveNamed(data: GameData, lookup: Lookup, name: string): Move | undefined {
  const known = data.moves[lookup.moveByName.get(name.toLowerCase()) ?? -1]
  if (known) return known
  const t = data.chart.types.indexOf(/^Hidden Power (\w+)$/i.exec(name)?.[1] ?? '')
  return t < 0 ? undefined : { n: name, t, p: 60, c: 'special', g: 2 }
}

/** The saved pick resolved against the data; null when the name isn't in the dex. */
export function resolveOpponent(data: GameData, lookup: Lookup, saved: SavedOpponent | null): Opponent | null {
  if (!saved) return null
  const d = lookup.dexByName.get(saved.name.toLowerCase())
  const entry = d === undefined ? undefined : data.dex[d]
  if (!entry || d === undefined) return null
  const moves = (saved.mv ?? []).map((n) => moveNamed(data, lookup, n)).filter((m): m is Move => m !== undefined)
  return {
    name: entry.n,
    d,
    types: entry.t,
    stats: entry.s,
    // Abilities arrived in Generation 3.
    ability: (data.gen ?? 9) < 3 ? '' : saved.ability,
    level: saved.lv ?? null,
    moves,
    nature: saved.nt === undefined ? null : (data.natures[saved.nt] ?? null),
    evs: saved.ev,
    ivs: saved.iv,
    item: saved.item ?? '',
    trainer: saved.trainer,
    setup: (saved.mv ?? []).find((n) => SETUP_MOVES.has(n.trim().toLowerCase())) ?? null,
  }
}

const asBattler = (m: Member): Battler => ({ level: m.level, base: m.stats, types: m.types, ability: m.ability, nature: m.nature })

const foeBattler = (o: Opponent, fallbackLevel: number): Battler => ({
  level: o.level ?? fallbackLevel,
  base: o.stats,
  types: o.types,
  ability: o.ability,
  nature: o.nature,
  evs: o.evs,
  ivs: o.ivs,
  item: o.item,
})

/** Learnset moves that could stand in for unknown ones. */
function learnsetMoves(data: GameData, opponent: Opponent): Move[] {
  return (data.learnsets[opponent.d] ?? [])
    .map((i) => data.moves[i])
    .filter((m): m is Move => !!m && m.p > 0 && m.p <= FALLBACK_MAX_POWER)
}

/** One placeholder move per type, for a side with no moves to go on. */
function guessMoves(data: GameData, types: number[], stats: number[]): Move[] {
  const physical = (stats[STAT.ATTACK] ?? 0) >= (stats[STAT.SP_ATTACK] ?? 0)
  return types.map((t) => ({
    n: `${data.chart.types[t] ?? '?'} move`,
    t,
    p: GUESS_POWER,
    c: physical ? 'physical' : 'special',
    g: 1,
  }))
}

function offenceOptions(data: GameData, member: Member, opponent: Opponent): OffenceDetail[] {
  return member.attackTypes.map((attackType) => {
    const raw = effectiveness(data.chart, attackType, opponent.types)
    const { multiplier, cause } = applyDefensiveAbility(
      raw,
      opponent.ability,
      data.chart.types[attackType] ?? '',
    )
    const stab = hasStab(member, attackType)
    return { attackType, multiplier, stab, value: multiplier * (stab ? STAB : 1), cause }
  })
}

/** Worst type matchup among the attack types the opponent actually uses. */
function worstIncoming(data: GameData, member: Member, opponent: Opponent): IncomingDetail | null {
  const used = opponent.moves.filter((m) => m.p > 0).map((m) => m.t)
  let worst: IncomingDetail | null = null
  for (const attackType of new Set(used.length ? used : opponent.types)) {
    const { multiplier, cause } = incomingMultiplier(data, member, attackType)
    if (!worst || multiplier > worst.multiplier) worst = { attackType, multiplier, cause }
  }
  return worst
}

export function rankMember(
  data: GameData,
  member: Member,
  opponent: Opponent,
  slot: number,
): Ranking {
  const options = offenceOptions(data, member, opponent)
  const best = options.reduce<OffenceDetail | null>(
    (acc, o) => (!acc || o.value > acc.value ? o : acc),
    null,
  )

  const me = asBattler(member)
  const foe = foeBattler(opponent, member.level)
  const memberDex = member.entry.d >= 0 ? member.entry.d : undefined
  const foeDex = opponent.d >= 0 ? opponent.d : undefined

  let takes: Hit | null
  let coverage: Hit | null = null
  if (opponent.moves.length) {
    takes = strongest(data, foe, me, opponent.moves, memberDex)
  } else {
    const pool = learnsetMoves(data, opponent)
    const own = pool.filter((m) => opponent.types.includes(m.t))
    takes = strongest(data, foe, me, own.length ? own : guessMoves(data, opponent.types, opponent.stats), memberDex)
    const other = strongest(data, foe, me, pool.filter((m) => !opponent.types.includes(m.t)), memberDex)
    if (other && other.max > (takes?.max ?? 0)) coverage = other
  }

  const known = member.moves.filter((m) => m.p > 0)
  const deals = strongest(data, me, foe, known.length ? known : guessMoves(data, member.types, member.stats), foeDex)

  const mySpeed = statAt(me, STAT.SPEED)
  const theirSpeed = statAt(foe, STAT.SPEED)
  const faster = mySpeed === theirSpeed ? null : mySpeed > theirSpeed
  const theirHits = hitsToKo(Math.max(takes?.max ?? 0, coverage?.max ?? 0))
  const myHits = hitsToKo(deals?.min ?? 0)

  return {
    slot,
    name: member.entry.n,
    best,
    neutral: options.filter((o) => o.multiplier === 1),
    worstIncoming: worstIncoming(data, member, opponent),
    takes,
    deals,
    dealsGuessed: known.length === 0,
    coverage,
    theirHits,
    myHits,
    survives: theirHits > 1 || (faster === true && myHits === 1),
    wins: faster === true ? myHits <= theirHits : myHits < theirHits,
    ohkoRisk: theirHits === 1,
    setupRisk: opponent.setup !== null && myHits >= 3,
    faster,
  }
}

const speedRank = (r: Ranking): number => (r.faster === true ? 0 : r.faster === null ? 1 : 2)

/** Infinity-safe comparison: a - b, with equal infinities equal. */
const cmp = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1)

/**
 * Survive, then win (Design.md section 5), the same in every hack: members
 * that can't hurt it go last; then those that live through its hardest hit;
 * then those that win the exchange; then most hits to knock out (defence
 * first), fewest hits needed, faster, and slot so the order is stable.
 */
export function rankMembers(
  data: GameData,
  members: readonly Member[],
  opponent: Opponent,
): Ranking[] {
  return members
    .map((m, i) => rankMember(data, m, opponent, i))
    .sort(
      (a, b) =>
        Number(a.myHits === Infinity) - Number(b.myHits === Infinity) ||
        Number(b.survives) - Number(a.survives) ||
        Number(b.wins) - Number(a.wins) ||
        cmp(b.theirHits, a.theirHits) ||
        cmp(a.myHits, b.myHits) ||
        speedRank(a) - speedRank(b) ||
        a.slot - b.slot,
    )
}

export interface LearningTip {
  move: Move
  stab: boolean
  /** Top-roll damage of the suggested move against this opponent, percent of its Hit Points. */
  value: number
  /** Same for the member's current best move. */
  currentValue: number
}

/** Minimum power worth recommending; below this the suggestion is noise. */
const TIP_MIN_POWER = 60

/** The new move must beat the current best by this margin to be worth it. */
const TIP_MARGIN = 1.2

/**
 * A move this member could learn that would hit the opponent meaningfully
 * harder than anything it currently knows.
 */
export function learningTip(
  data: GameData,
  member: Member,
  opponent: Opponent,
): LearningTip | null {
  if (member.entry.d < 0) return null
  const me = asBattler(member)
  const foe = foeBattler(opponent, member.level)
  const foeDex = opponent.d >= 0 ? opponent.d : undefined
  const damage = (move: Move): number => estimate(data, me, foe, move, foeDex)?.max ?? 0

  const currentValue = member.moves.reduce((best, m) => Math.max(best, damage(m)), 0)

  let best: LearningTip | null = null
  for (const mi of data.learnsets[member.entry.d] ?? []) {
    const move = data.moves[mi]
    if (!move || move.p < TIP_MIN_POWER) continue
    if (member.moves.some((m) => m.n === move.n)) continue
    const value = damage(move)
    if (!best || value > best.value) {
      best = { move, stab: hasStab(member, move.t), value, currentValue }
    }
  }

  if (!best || best.value <= currentValue * TIP_MARGIN) return null
  return best
}

// ------------------------------------------------------------- explanations

/** "Ground STAB deals double damage (x2) to Gengar" */
export function describeOffence(
  data: GameData,
  detail: OffenceDetail,
  opponentName: string,
): string {
  const type = data.chart.types[detail.attackType] ?? '?'
  const stab = detail.stab ? ' with Same-Type Attack Bonus' : ''
  const via = detail.cause ? ` (via ${detail.cause})` : ''
  return `${type}${stab} deals ${describeMultiplier(detail.multiplier)} to ${opponentName}${via}`
}

/** "Gengar's Ghost attacks deal quarter damage (x0.25)" */
export function describeIncoming(
  data: GameData,
  detail: IncomingDetail,
  opponentName: string,
): string {
  const type = data.chart.types[detail.attackType] ?? '?'
  const via = detail.cause ? ` (via ${detail.cause})` : ''
  return `${opponentName}'s ${type} attacks deal ${describeMultiplier(detail.multiplier)}${via}`
}

/** "38-45% (Earthquake)" */
export function describeHit(hit: Hit): string {
  return `${hit.min}–${hit.max}% (${hit.move.n})`
}

export function describeSpeed(ranking: Ranking, opponentName: string): string {
  if (ranking.faster === null) return `Matches ${opponentName} for Speed`
  return ranking.faster
    ? `Outspeeds ${opponentName}`
    : `Slower than ${opponentName}`
}
