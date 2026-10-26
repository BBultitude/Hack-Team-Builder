/** Loads the generated JSON for tests. Node-only; the app fetches instead. */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameData } from '../types'
import { buildLookup, type Lookup } from './lookup'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../data')

const read = <T>(file: string): T => JSON.parse(readFileSync(join(DATA, file), 'utf8')) as T

export const data: GameData = {
  chart: read('typechart.json'),
  dex: read('dex.json'),
  moves: read('moves.json'),
  learnsets: read('learnsets.json'),
  natures: read('natures.json'),
  catchMoves: read('catch.json'),
}

export const lookup: Lookup = buildLookup(data)

export const typeIndex = (name: string): number => {
  const i = data.chart.types.indexOf(name)
  if (i < 0) throw new Error(`unknown type ${name}`)
  return i
}

export const dexIndex = (name: string): number => {
  const i = lookup.dexByName.get(name.toLowerCase())
  if (i === undefined) throw new Error(`unknown Pokemon ${name}`)
  return i
}
