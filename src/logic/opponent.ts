import type { GameData, Move } from '../types'
import { STAT } from '../types'
import { applyDefensiveAbility } from './abilities'
import { type Member, effectiveSpeed, hasStab, incomingMultiplier } from './member'
import { describeMultiplier, effectiveness } from './typeChart'

/**
 * Ranks team members against a single opponent.
 *
 * Assumption, stated in Design.md section 5: the opponent attacks only with
 * moves of its own types. Without a move list for it, that is the fairest
 * guess and it keeps the explanations honest.
 */

/** Same-Type Attack Bonus. */
const STAB = 1.5

/** Floors keep log2 finite when a matchup is a total immunity. */
const MIN_OFFENCE = 0.1
const MIN_INCOMING = 0.125

const SPEED_BONUS = 0.5

export interface Opponent {
  name: string
  types: number[]
  stats: number[]
  ability: string
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
  score: number
  best: OffenceDetail | null
  /** Attack options that land for normal damage, listed separately. */
  neutral: OffenceDetail[]
  worstIncoming: IncomingDetail | null
  /** null when speeds are equal. */
  faster: boolean | null
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

function worstIncoming(data: GameData, member: Member, opponent: Opponent): IncomingDetail | null {
  let worst: IncomingDetail | null = null
  for (const attackType of opponent.types) {
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
  const incoming = worstIncoming(data, member, opponent)

  const mySpeed = effectiveSpeed(member)
  const theirSpeed = opponent.stats[STAT.SPEED] ?? 0
  const faster = mySpeed === theirSpeed ? null : mySpeed > theirSpeed

  const offenceValue = Math.max(best?.value ?? 0, MIN_OFFENCE)
  const incomingValue = Math.max(incoming?.multiplier ?? 0, MIN_INCOMING)

  let score = 2 * Math.log2(offenceValue) - 2 * Math.log2(incomingValue)
  if (faster === true) score += SPEED_BONUS
  else if (faster === false) score -= SPEED_BONUS

  return {
    slot,
    name: member.entry.n,
    score,
    best,
    neutral: options.filter((o) => o.multiplier === 1),
    worstIncoming: incoming,
    faster,
  }
}

/** Highest score first; ties break on slot so the order is stable. */
export function rankMembers(
  data: GameData,
  members: readonly Member[],
  opponent: Opponent,
): Ranking[] {
  return members
    .map((m, i) => rankMember(data, m, opponent, i))
    .sort((a, b) => b.score - a.score || a.slot - b.slot)
}

export interface LearningTip {
  move: Move
  stab: boolean
  /** Effective damage of the suggested move against this opponent. */
  value: number
  /** Effective damage of the member's current best move. */
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

  const damage = (move: Move): number => {
    const raw = effectiveness(data.chart, move.t, opponent.types)
    const { multiplier } = applyDefensiveAbility(
      raw,
      opponent.ability,
      data.chart.types[move.t] ?? '',
    )
    return move.p * multiplier * (hasStab(member, move.t) ? STAB : 1)
  }

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

export function describeSpeed(ranking: Ranking, opponentName: string): string {
  if (ranking.faster === null) return `Matches ${opponentName} for Speed`
  return ranking.faster
    ? `Outspeeds ${opponentName}`
    : `Slower than ${opponentName}`
}
