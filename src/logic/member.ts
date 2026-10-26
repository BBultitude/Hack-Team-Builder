import type { GameData, Move, Nature, RosterEntry } from '../types'
import { STAT } from '../types'
import type { Lookup } from './lookup'
import { applyDefensiveAbility, type DefenceResult } from './abilities'
import { effectiveness } from './typeChart'
import { effectiveStat, roleOf, type Role } from './stats'

/** A roster entry resolved against the loaded data, ready for scoring. */
export interface Member {
  entry: RosterEntry
  /** One or two type indices. */
  types: number[]
  /** Six base stats, overrides applied. */
  stats: number[]
  ability: string
  nature: Nature | null
  /** Entered moves that resolved to known moves. */
  moves: Move[]
  /**
   * Types this member can attack with. The entered moves' types, or its own
   * types when no moves have been entered.
   */
  attackTypes: number[]
  /** True when attackTypes came from the fallback rather than real moves. */
  assumedFromTypes: boolean
  role: Role
}

export function resolveMember(data: GameData, lookup: Lookup, entry: RosterEntry): Member {
  const types = entry.b >= 0 ? [entry.a, entry.b] : [entry.a]

  const vanilla = entry.d >= 0 ? data.dex[entry.d] : undefined
  const stats = entry.st ?? vanilla?.s ?? [0, 0, 0, 0, 0, 0]

  const moves: Move[] = []
  for (const name of entry.mv) {
    if (!name) continue
    const i = lookup.moveByName.get(name.toLowerCase())
    const move = i === undefined ? undefined : data.moves[i]
    if (move) moves.push(move)
  }

  const fromMoves = [...new Set(moves.map((m) => m.t))]
  const assumedFromTypes = fromMoves.length === 0
  const nature = data.natures[entry.nt] ?? null

  return {
    entry,
    types,
    stats,
    ability: entry.ab,
    nature,
    moves,
    attackTypes: assumedFromTypes ? types : fromMoves,
    assumedFromTypes,
    role: roleOf(stats, nature),
  }
}

/** Incoming damage multiplier of an attacking type against this member. */
export function incomingMultiplier(
  data: GameData,
  member: Member,
  attackType: number,
): DefenceResult {
  const base = effectiveness(data.chart, attackType, member.types)
  return applyDefensiveAbility(base, member.ability, data.chart.types[attackType] ?? '')
}

/** Speed after the nature is applied. */
export function effectiveSpeed(member: Member): number {
  return effectiveStat(member.stats[STAT.SPEED] ?? 0, STAT.SPEED, member.nature)
}

/** Same-Type Attack Bonus applies when the move shares one of the user's types. */
export function hasStab(member: Member, moveType: number): boolean {
  return member.types.includes(moveType)
}
