import type { GameData, RosterEntry } from '../types'
import { DEFAULT_LEVEL, entryFromDex } from './member'
import type { Lookup } from './lookup'

/**
 * The Pokedex tab's checklist: the game's dex as rows, each ticked when the
 * player owns that species (Design.md section 5).
 */

export type DexMode = 'regional' | 'national'

/** Battle-only forms: never caught, so never on the checklist. */
const UNCATCHABLE_FORM = /\((Mega|Primal|Gigantamax|Eternamax)\b/

/**
 * Dex indices in the order the player's game lists them: the hack's regional
 * dex when it has one and that mode is chosen, else the National Dex up to
 * the setup's generation cap, forms after their base species.
 */
export function dexList(data: GameData, lookup: Lookup, mode: DexMode, regional?: readonly string[]): number[] {
  const gen = data.gen ?? 9
  const shown = (i: number): boolean => {
    const d = data.dex[i]
    return !!d && d.g <= gen && !UNCATCHABLE_FORM.test(d.n)
  }
  if (mode === 'regional' && regional?.length) {
    return regional.map((n) => lookup.dexByName.get(n.toLowerCase())).filter((i): i is number => i !== undefined && shown(i))
  }
  return data.dex
    .map((_, i) => i)
    .filter(shown)
    .sort((a, b) => data.dex[a]!.id - data.dex[b]!.id || a - b)
}

/** Roster indices owning each dex index, in roster order. */
export function ownership(roster: readonly RosterEntry[]): Map<number, number[]> {
  const owned = new Map<number, number[]>()
  roster.forEach((e, i) => {
    if (e.d < 0) return
    owned.set(e.d, [...(owned.get(e.d) ?? []), i])
  })
  return owned
}

/** True when the player changed anything from a fresh catch, so unticking would lose work. */
export function hasEdits(data: GameData, entry: RosterEntry): boolean {
  if (entry.d < 0) return true
  const fresh = entryFromDex(data, entry.n, entry.d)
  return (
    entry.a !== fresh.a ||
    entry.b !== fresh.b ||
    entry.ab !== fresh.ab ||
    entry.nt !== fresh.nt ||
    entry.st !== null ||
    (entry.lv ?? DEFAULT_LEVEL) !== DEFAULT_LEVEL ||
    entry.mv.some((m) => m.trim() !== '')
  )
}
