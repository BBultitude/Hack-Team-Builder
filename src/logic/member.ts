import type { GameData, Move, Nature, RosterEntry } from '../types'
import type { Lookup } from './lookup'
import { applyDefensiveAbility, type DefenceResult } from './abilities'
import { effectiveness } from './typeChart'
import { roleOf, type Role } from './stats'

/** Level assumed for Pokemon saved before levels existed. */
export const DEFAULT_LEVEL = 50

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
  level: number
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
    // Abilities arrived in Generation 3.
    ability: (data.gen ?? 9) < 3 ? '' : entry.ab,
    nature,
    moves,
    attackTypes: assumedFromTypes ? types : fromMoves,
    assumedFromTypes,
    role: roleOf(stats, nature),
    level: entry.lv ?? DEFAULT_LEVEL,
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

/** Same-Type Attack Bonus applies when the move shares one of the user's types. */
export function hasStab(member: Member, moveType: number): boolean {
  return member.types.includes(moveType)
}

/** A fresh roster entry for a dex species, or a custom one when dexIndex is undefined. */
export function entryFromDex(data: GameData, name: string, dexIndex: number | undefined): RosterEntry {
  const vanilla = dexIndex === undefined ? undefined : data.dex[dexIndex]
  return {
    n: vanilla?.n ?? name,
    a: vanilla?.t[0] ?? 0,
    b: vanilla?.t[1] ?? -1,
    ab: vanilla?.ab[0] ?? '',
    nt: Math.max(data.natures.findIndex((n) => n.up === null), 0),
    mv: ['', '', '', ''],
    st: null,
    d: dexIndex ?? -1,
    lv: DEFAULT_LEVEL,
  }
}

/**
 * The same Pokemon after evolving: nature and moves carry over, the ability
 * too when the evolution can have it. Stat overrides described the old form,
 * so they are dropped.
 */
export function evolve(data: GameData, entry: RosterEntry, target: number): RosterEntry {
  const next = entryFromDex(data, '', target)
  const dex = data.dex[target]
  const keepsAbility = !!dex && [...dex.ab, ...dex.hab].includes(entry.ab)
  return { ...next, nt: entry.nt, mv: [...entry.mv], ab: keepsAbility ? entry.ab : next.ab, lv: entry.lv ?? DEFAULT_LEVEL }
}

/** Dex indices from one stage to a later one, both ends included; [to] when unrelated. */
export function evolutionPath(data: GameData, from: number, to: number): number[] {
  const walk = (at: number): number[] | null => {
    if (at === to) return [at]
    for (const next of data.dex[at]?.ev ?? []) {
      const rest = walk(next)
      if (rest) return [at, ...rest]
    }
    return null
  }
  return walk(from) ?? [to]
}
