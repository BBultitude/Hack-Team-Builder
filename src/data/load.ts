import chartUrl from '../../data/typechart.json?url'
import dexUrl from '../../data/dex.json?url'
import movesUrl from '../../data/moves.json?url'
import learnsetsUrl from '../../data/learnsets.json?url'
import naturesUrl from '../../data/natures.json?url'
import catchUrl from '../../data/catch.json?url'
import catchGensUrl from '../../data/catchgens.json?url'
import learnGensUrl from '../../data/learngens.json?url'
import unboundUrl from '../../data/hacks/unbound.json?url'
import rogueUrl from '../../data/hacks/rogue.json?url'
import type { GameData, HackPack } from '../types'
import type { Hack } from '../logic/storage'

/**
 * Vite content-hashes these URLs, so the browser caches them indefinitely
 * and picks up a regeneration automatically.
 */
async function json<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function loadGameData(): Promise<GameData> {
  const [chart, dex, moves, learnsets, natures, catchMoves, catchGens, learnGens] = await Promise.all([
    json<GameData['chart']>(chartUrl),
    json<GameData['dex']>(dexUrl),
    json<GameData['moves']>(movesUrl),
    json<GameData['learnsets']>(learnsetsUrl),
    json<GameData['natures']>(naturesUrl),
    json<GameData['catchMoves']>(catchUrl),
    json<GameData['catchGens']>(catchGensUrl),
    json<GameData['learnGens']>(learnGensUrl),
  ])
  return { chart, dex, moves, learnsets, learnGens, natures, catchMoves, catchGens }
}

const HACK_URLS: Record<Hack, string> = { unbound: unboundUrl, rogue: rogueUrl }

/** Only the active setup's pack is fetched. */
export const loadHack = (hack: Hack): Promise<HackPack> => json<HackPack>(HACK_URLS[hack])
