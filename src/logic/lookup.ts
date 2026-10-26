import type { GameData } from '../types'

/** Name-keyed indexes built once per data load. */
export interface Lookup {
  moveByName: Map<string, number>
  dexByName: Map<string, number>
}

export function buildLookup(data: GameData): Lookup {
  const moveByName = new Map<string, number>()
  data.moves.forEach((m, i) => moveByName.set(m.n.toLowerCase(), i))
  const dexByName = new Map<string, number>()
  data.dex.forEach((d, i) => dexByName.set(d.n.toLowerCase(), i))
  return { moveByName, dexByName }
}
