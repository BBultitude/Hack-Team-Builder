import type { GameData, Move, RosterEntry } from '../types'
import type { Lookup } from './lookup'
import { type Member, hasStab, incomingMultiplier, resolveMember } from './member'
import { effectiveness } from './typeChart'

export const MAX_TEAM = 6

/** Weight on offensive coverage relative to the defensive score. */
const COVERAGE_WEIGHT = 1.5

/** How many weaknesses on one type before the team-level penalty applies. */
const STACKED_WEAKNESS_THRESHOLD = 3
const STACKED_WEAKNESS_PENALTY = 2

export interface TypeExposure {
  type: number
  /** Doubled for a 4x weakness, per Design.md section 5. */
  weak: number
  resist: number
  /** Contribution of this type to the defensive score. */
  score: number
  /** Multiplier against each member, in team order, abilities applied. */
  cells: number[]
}

export interface TeamAnalysis {
  /** One row per attacking type, in chart order. */
  grid: TypeExposure[]
  defensiveScore: number
  /** Types hit super-effectively by at least one attack option. */
  covered: number[]
  uncovered: number[]
  /** Types the team is weak to and nothing on it resists. */
  exposed: number[]
  score: number
  roles: { physical: number; special: number; mixed: number }
  /** Members with no ability set — their defensive numbers may be wrong. */
  membersMissingAbility: string[]
}

/** Scores one member's matchup against one attacking type. */
function rate(multiplier: number): { weak: number; resist: number; score: number } {
  if (multiplier >= 3) return { weak: 2, resist: 0, score: -2 }
  if (multiplier > 1) return { weak: 1, resist: 0, score: -1 }
  if (multiplier === 0) return { weak: 0, resist: 1, score: 1.5 }
  if (multiplier <= 0.5) return { weak: 0, resist: 1, score: 1 }
  return { weak: 0, resist: 0, score: 0 }
}

export function analyseTeam(data: GameData, members: readonly Member[]): TeamAnalysis {
  const typeCount = data.chart.types.length
  const grid: TypeExposure[] = []
  let defensiveScore = 0

  for (let t = 0; t < typeCount; t++) {
    let weak = 0
    let resist = 0
    let score = 0
    const cells: number[] = []
    for (const m of members) {
      const multiplier = incomingMultiplier(data, m, t).multiplier
      cells.push(multiplier)
      const r = rate(multiplier)
      weak += r.weak
      resist += r.resist
      score += r.score
    }
    if (weak >= STACKED_WEAKNESS_THRESHOLD && weak > resist) score -= STACKED_WEAKNESS_PENALTY
    defensiveScore += score
    grid.push({ type: t, weak, resist, score, cells })
  }

  const coveredSet = new Set<number>()
  for (const m of members) {
    for (const a of m.attackTypes) {
      for (let t = 0; t < typeCount; t++) {
        if ((data.chart.matrix[a]?.[t] ?? 1) > 1) coveredSet.add(t)
      }
    }
  }

  const covered: number[] = []
  const uncovered: number[] = []
  for (let t = 0; t < typeCount; t++) (coveredSet.has(t) ? covered : uncovered).push(t)

  const roles = { physical: 0, special: 0, mixed: 0 }
  for (const m of members) {
    if (m.role === 'Physical') roles.physical++
    else if (m.role === 'Special') roles.special++
    else roles.mixed++
  }

  return {
    grid,
    defensiveScore,
    covered,
    uncovered,
    exposed: grid.filter((g) => g.weak > 0 && g.resist === 0).map((g) => g.type),
    score: defensiveScore + COVERAGE_WEIGHT * covered.length,
    roles,
    membersMissingAbility: members.filter((m) => !m.ability.trim()).map((m) => m.entry.n),
  }
}

/** Convenience wrapper that resolves entries before analysing. */
export function analyseRoster(
  data: GameData,
  lookup: Lookup,
  roster: readonly RosterEntry[],
  indices: readonly number[],
): TeamAnalysis {
  const members = indices
    .map((i) => roster[i])
    .filter((e): e is RosterEntry => e !== undefined)
    .map((e) => resolveMember(data, lookup, e))
  return analyseTeam(data, members)
}

function scoreOf(
  data: GameData,
  lookup: Lookup,
  roster: readonly RosterEntry[],
  indices: readonly number[],
): number {
  return analyseRoster(data, lookup, roster, indices).score
}

export interface Suggestion {
  index: number
  gain: number
}

/** Roster members not on the team, ranked by what adding them would gain. */
export function suggestAdditions(
  data: GameData,
  lookup: Lookup,
  roster: readonly RosterEntry[],
  team: readonly number[],
  limit = 3,
): Suggestion[] {
  if (team.length >= MAX_TEAM) return []
  const base = scoreOf(data, lookup, roster, team)
  const out: Suggestion[] = []
  for (let i = 0; i < roster.length; i++) {
    if (team.includes(i)) continue
    out.push({ index: i, gain: scoreOf(data, lookup, roster, [...team, i]) - base })
  }
  // Ties break on roster index so the list is stable between renders.
  out.sort((a, b) => b.gain - a.gain || a.index - b.index)
  return out.slice(0, limit)
}

export interface LearnableFix {
  /** Type that is currently uncovered. */
  type: number
  /** Index into the team array, not the roster. */
  memberSlot: number
  memberName: string
  move: Move
  stab: boolean
  /** Base power with the Same-Type Attack Bonus folded in; used for ranking. */
  rating: number
}

/**
 * For each uncovered type, the best move any team member could learn that
 * would cover it. Ranked by base power, with Same-Type Attack Bonus applied.
 */
export function learnableFixes(
  data: GameData,
  members: readonly Member[],
  uncovered: readonly number[],
): LearnableFix[] {
  const out: LearnableFix[] = []

  for (const t of uncovered) {
    let best: LearnableFix | null = null
    members.forEach((m, slot) => {
      if (m.entry.d < 0) return // custom Pokemon have no vanilla learnset
      for (const mi of data.learnsets[m.entry.d] ?? []) {
        const move = data.moves[mi]
        if (!move || move.p <= 0) continue
        if ((data.chart.matrix[move.t]?.[t] ?? 1) <= 1) continue
        const stab = hasStab(m, move.t)
        const rating = move.p * (stab ? 1.5 : 1)
        if (!best || rating > best.rating) {
          best = { type: t, memberSlot: slot, memberName: m.entry.n, move, stab, rating }
        }
      }
    })
    if (best) out.push(best)
  }

  return out
}

/**
 * Picks the best team from the roster: greedy fill, then swap hill-climbing.
 * Deterministic — every tie breaks on the lowest roster index.
 */
export function autoBuild(
  data: GameData,
  lookup: Lookup,
  roster: readonly RosterEntry[],
): number[] {
  if (roster.length <= MAX_TEAM) return roster.map((_, i) => i)

  const team: number[] = []
  while (team.length < MAX_TEAM) {
    let bestIndex = -1
    let bestScore = -Infinity
    for (let i = 0; i < roster.length; i++) {
      if (team.includes(i)) continue
      const s = scoreOf(data, lookup, roster, [...team, i])
      if (s > bestScore) {
        bestScore = s
        bestIndex = i
      }
    }
    if (bestIndex < 0) break
    team.push(bestIndex)
  }

  // Hill-climb on single swaps. The score strictly increases each round, so
  // this terminates; the epsilon keeps floating-point noise from looping.
  const EPSILON = 1e-9
  for (;;) {
    let current = scoreOf(data, lookup, roster, team)
    let bestSlot = -1
    let bestCandidate = -1
    let bestScore = current

    for (let slot = 0; slot < team.length; slot++) {
      for (let cand = 0; cand < roster.length; cand++) {
        if (team.includes(cand)) continue
        const trial = [...team]
        trial[slot] = cand
        const s = scoreOf(data, lookup, roster, trial)
        if (s > bestScore + EPSILON) {
          bestScore = s
          bestSlot = slot
          bestCandidate = cand
        }
      }
    }

    if (bestSlot < 0) break
    team[bestSlot] = bestCandidate
    current = bestScore
  }

  return team.sort((a, b) => a - b)
}

/** Attack options a member brings, for display. */
export function attackOptionNames(data: GameData, member: Member): string[] {
  return member.attackTypes.map((t) => data.chart.types[t] ?? '?')
}

export function superEffective(data: GameData, attackType: number, defendTypes: number[]): boolean {
  return effectiveness(data.chart, attackType, defendTypes) > 1
}
