import type { DexEntry, GameData, HackPack, Move, RosterEntry } from '../types'
import { evolutionPath } from './member'

/**
 * A game setup is capped at "Pokemon up to and including Generation N", and
 * the game's rules follow from that (Design.md section 5). forSetup returns
 * a copy of the vanilla data adjusted for the cap, so every tab and every
 * calculation sees one consistent world without knowing about generations.
 */

export const MAX_GEN = 9

/** The type that decides a move's damage class before the Generation 4 physical/special split. */
const PHYSICAL_TYPES = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel'])

/** True when the entry exists in this setup; custom Pokemon always do. */
export function inGen(data: GameData, entry: Pick<RosterEntry, 'd'>): boolean {
  const dex = data.dex[entry.d]
  return !dex || dex.g <= (data.gen ?? MAX_GEN)
}

/** Value that applied in `gen`: the oldest past record still covering it, else the current one. */
function pastFor<T>(rows: [number, T][] | undefined, gen: number): T | undefined {
  return rows?.find(([last]) => last >= gen)?.[1]
}

function chartFor(data: GameData, gen: number): GameData['chart'] {
  if (gen >= 6) return data.chart
  // Fairy is last in the type order, so dropping it shifts no other index.
  const fairy = data.chart.types.indexOf('Fairy')
  const types = data.chart.types.slice(0, fairy)
  const matrix = data.chart.matrix.slice(0, fairy).map((row) => row.slice(0, fairy))
  // Before Generation 6, Steel also resisted Ghost and Dark.
  const steel = types.indexOf('Steel')
  for (const name of ['Ghost', 'Dark']) matrix[types.indexOf(name)]![steel] = 0.5
  return { types, matrix }
}

function abilitiesFor(e: DexEntry, gen: number): Pick<DexEntry, 'ab' | 'hab'> {
  if (gen < 3) return { ab: [], hab: [] }
  // Slots 1-2 are regular abilities, slot 3 the hidden one.
  const slots = [e.ab[0] ?? '', e.ab[1] ?? '', e.hab[0] ?? '']
  for (let slot = 1; slot <= 3; slot++) {
    const rows = e.pa?.filter(([, s]) => s === slot).map(([last, , name]) => [last, name] as [number, string])
    const past = pastFor(rows?.sort((a, b) => a[0] - b[0]), gen)
    if (past !== undefined) slots[slot - 1] = past
  }
  return {
    ab: [slots[0]!, slots[1]!].filter(Boolean),
    hab: gen >= 5 && slots[2] ? [slots[2]] : [],
  }
}

/**
 * Vanilla data with a hack's changes applied: changed species, the forms it
 * adds (appended, so vanilla indices stay put), and extra level-up moves.
 * Apply before forSetup; hack values replace the vanilla generation history.
 */
export function withHack(data: GameData, pack: HackPack | null): GameData {
  if (!pack) return data
  const byName = new Map(data.dex.map((d, i) => [d.n, i]))
  const moveByName = new Map(data.moves.map((m, i) => [m.n, i]))
  const dex = [...data.dex]
  const learnsets = [...data.learnsets]
  const learnGens = [...data.learnGens]

  for (const [name, change] of Object.entries(pack.dex)) {
    const { base, ...fields } = change
    const i = byName.get(name)
    if (i !== undefined) {
      const next: DexEntry = { ...dex[i]!, ...fields }
      if (fields.t) delete next.pt
      if (fields.ab || fields.hab) delete next.pa
      dex[i] = next
      continue
    }
    const from = base === undefined ? undefined : byName.get(base)
    if (from === undefined || !fields.t || !fields.s) continue
    const b = data.dex[from]!
    // A form: the base's sprite, family and debut, the hack's types, stats and abilities.
    dex.push({ n: name, id: b.id, g: b.g, cr: fields.cr ?? b.cr, fm: b.fm, t: fields.t, s: fields.s, ab: fields.ab ?? [], hab: fields.hab ?? [] })
    learnsets.push(data.learnsets[from] ?? [])
    learnGens.push(data.learnGens[from] ?? '')
  }

  for (const [name, moves] of Object.entries(pack.learn ?? {})) {
    const i = byName.get(name)
    if (i === undefined) continue
    const extra = moves.map((m) => moveByName.get(m)).filter((m): m is number => m !== undefined)
    learnsets[i] = [...(learnsets[i] ?? []), ...extra]
    // Learnable from the hack's start; forSetup still drops moves newer than the cap.
    learnGens[i] = (learnGens[i] ?? '') + '1'.repeat(extra.length)
  }

  const after = new Map(dex.map((d, i) => [d.n, i]))
  const obtain = pack.obtain
    ? Object.fromEntries(
        Object.entries(pack.obtain)
          .map(([name, where]) => [after.get(name), where] as const)
          .filter((e): e is readonly [number, string] => e[0] !== undefined),
      )
    : undefined

  return { ...data, dex, learnsets, learnGens, ...(obtain ? { obtain } : {}) }
}

export function forSetup(data: GameData, gen: number): GameData {
  if (gen >= MAX_GEN) return data
  const chart = chartFor(data, gen)
  const typeCount = chart.types.length

  const moves: Move[] = data.moves.map((m) =>
    gen <= 3 && m.g <= gen ? { ...m, c: PHYSICAL_TYPES.has(chart.types[m.t] ?? '') ? 'physical' : 'special' } : m,
  )

  const learnsets: number[][] = []
  const learnGens: string[] = []
  data.learnsets.forEach((list, i) => {
    const gens = data.learnGens[i] ?? ''
    const keep = list.map((_, j) => j).filter((j) => Number(gens[j] ?? 9) <= gen && (data.moves[list[j]!]?.g ?? 9) <= gen)
    learnsets.push(keep.map((j) => list[j]!))
    learnGens.push(keep.map((j) => gens[j]).join(''))
  })

  const catchMoves: GameData['catchMoves'] = {}
  const catchGens: GameData['catchGens'] = {}
  for (const [move, learners] of Object.entries(data.catchMoves)) {
    const gens = data.catchGens[move] ?? ''
    const keep = learners.map((_, j) => j).filter((j) => Number(gens[j] ?? 9) <= gen)
    catchMoves[move] = keep.map((j) => learners[j]!)
    catchGens[move] = keep.map((j) => gens[j]).join('')
  }

  const dex: DexEntry[] = data.dex.map((e, i) => {
    const pastTypes = pastFor(e.pt, gen)
    let t = (pastTypes ?? e.t).filter((x) => x < typeCount)
    if (t.length === 0) t = [0]

    const ev = e.ev?.map((target, k) => ({ target, how: e.eh?.[k] })).filter(({ target }) => (data.dex[target]?.g ?? 99) <= gen)

    const next: DexEntry = { ...e, t, ...abilitiesFor(e, gen) }
    delete next.ev
    delete next.eh
    delete next.ok
    delete next.cf
    if (ev?.length) {
      next.ev = ev.map((x) => x.target)
      next.eh = ev.map((x) => x.how ?? 'special conditions')
    }
    if (e.ok && e.g <= gen) {
      // Catch the earliest stage that exists in this generation (no Pichu in Gen 1).
      const path = evolutionPath(data, e.cf ?? i, i)
      next.ok = 1
      next.cf = path.find((stage) => (data.dex[stage]?.g ?? 99) <= gen) ?? i
    }
    return next
  })

  return { ...data, gen, chart, moves, learnsets, learnGens, catchMoves, catchGens, dex }
}

/**
 * Brings a roster over to another generation's rules. Types and abilities the
 * player never changed follow the vanilla data (Clefairy turns Normal below
 * Gen 6 and back again); anything edited by hand is left alone.
 */
export function adaptRoster(from: GameData, to: GameData, roster: readonly RosterEntry[]): RosterEntry[] {
  return roster.map((entry) => {
    const before = from.dex[entry.d]
    const after = to.dex[entry.d]
    if (!before || !after) return entry
    const next = { ...entry }
    const untouched = entry.a === before.t[0] && entry.b === (before.t[1] ?? -1)
    if (untouched) {
      next.a = after.t[0] ?? 0
      next.b = after.t[1] ?? -1
    }
    const wasVanilla = entry.ab === '' || [...before.ab, ...before.hab].includes(entry.ab)
    const stillValid = [...after.ab, ...after.hab].includes(entry.ab)
    if (wasVanilla && !stillValid) next.ab = after.ab[0] ?? ''
    return next
  })
}

/** Plain-English list of what a generation cap changes, for the setup picker. */
export function genNotes(gen: number): string[] {
  const notes: string[] = []
  if (gen < 6) notes.push('no Fairy type')
  if (gen <= 3) notes.push('physical or special set by move type')
  if (gen < 3) notes.push('no abilities')
  else if (gen < 5) notes.push('no hidden abilities')
  if (gen < 4) notes.push('no Quick or Dusk Ball')
  return notes
}

/** Pokedex names that exist in this setup, for search lists. */
export const dexNames = (data: GameData): string[] =>
  data.dex.filter((d) => d.g <= (data.gen ?? MAX_GEN)).map((d) => d.n)

/** Move names that exist in this setup, for the move picker. */
export const moveNames = (data: GameData): string[] =>
  data.moves.filter((m) => m.g <= (data.gen ?? MAX_GEN)).map((m) => m.n)
