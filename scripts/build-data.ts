/**
 * Regenerates data/*.json from the PokeAPI CSV dump.
 *
 * Source: https://github.com/PokeAPI/pokeapi (data/v2/csv), CC BY-NC-SA.
 * Run with `npm run build:data`. Outputs are committed, so a normal build
 * never touches the network. Downloads are cached in scripts/.cache so
 * re-runs are offline-capable.
 *
 * Filtering rules come from Design.md section 3.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CACHE = join(HERE, '.cache')
const OUT = join(ROOT, 'data')

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv'

const FILES = [
  'pokemon',
  'pokemon_types',
  'pokemon_stats',
  'pokemon_abilities',
  'pokemon_species_names',
  'ability_names',
  'types',
  'type_names',
  'type_efficacy',
  'moves',
  'move_names',
  'pokemon_moves',
  'natures',
  'nature_names',
] as const

/** English, per PokeAPI's languages.csv. */
const EN = 9

/** stat_id -> index in our six-stat array. */
const STAT_SLOT: Record<string, number> = {
  '1': 0, // Hit Points
  '2': 1, // Attack
  '3': 2, // Defense
  '4': 3, // Special Attack
  '5': 4, // Special Defense
  '6': 5, // Speed
}

/** Display order required by Design.md section 3. */
const TYPE_ORDER = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]

const PHYSICAL = '2'
const SPECIAL = '3'

// ---------------------------------------------------------------- utilities

/** Minimal RFC 4180 parser; PokeAPI quotes fields containing commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') { quoted = true }
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') { field += ch }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  const header = rows.shift()
  if (!header) return []
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function load(name: string): Promise<Record<string, string>[]> {
  const cached = join(CACHE, `${name}.csv`)
  if (!(await exists(cached))) {
    process.stdout.write(`  downloading ${name}.csv ... `)
    const res = await fetch(`${BASE}/${name}.csv`)
    if (!res.ok) throw new Error(`${name}.csv: HTTP ${res.status}`)
    await writeFile(cached, await res.text())
    process.stdout.write('done\n')
  }
  return parseCsv(await readFile(cached, 'utf8'))
}

/** Groups rows by a key column, preserving file order. */
function groupBy(
  rows: Record<string, string>[],
  key: string,
): Map<string, Record<string, string>[]> {
  const out = new Map<string, Record<string, string>[]>()
  for (const r of rows) {
    const k = r[key] ?? ''
    const bucket = out.get(k)
    if (bucket) bucket.push(r)
    else out.set(k, [r])
  }
  return out
}

/** Strips the species prefix off a form identifier: wormadam-sandy -> sandy. */
function formSuffix(identifier: string, baseSlug: string | undefined, baseName: string): string {
  const speciesSlug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  for (const prefix of [baseSlug, speciesSlug]) {
    if (prefix && identifier.startsWith(`${prefix}-`)) return identifier.slice(prefix.length + 1)
  }
  return identifier
}

/** "mega-x" -> "Mega X" */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

async function sourceCommit(): Promise<string> {
  try {
    const res = await fetch('https://api.github.com/repos/PokeAPI/pokeapi/commits/master')
    if (!res.ok) return 'unknown'
    const body = (await res.json()) as { sha?: string }
    return body.sha?.slice(0, 12) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// -------------------------------------------------------------------- build

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true })
  await mkdir(OUT, { recursive: true })

  console.log('Loading CSVs...')
  const csv = Object.fromEntries(
    await Promise.all(FILES.map(async (f) => [f, await load(f)] as const)),
  ) as Record<(typeof FILES)[number], Record<string, string>[]>

  // --- types and the 18x18 chart ------------------------------------------

  // type_id -> our 0..17 index, dropping shadow/unknown.
  const typeIndexById = new Map<string, number>()
  const typeNames: string[] = []
  const enTypeName = new Map<string, string>()
  for (const r of csv.type_names) {
    if (r.local_language_id === String(EN)) enTypeName.set(r.type_id!, r.name!)
  }
  for (const slug of TYPE_ORDER) {
    const row = csv.types.find((t) => t.identifier === slug)
    if (!row) throw new Error(`missing type ${slug}`)
    typeIndexById.set(row.id!, typeNames.length)
    typeNames.push(enTypeName.get(row.id!) ?? titleCase(slug))
  }

  // Default 1x; type_efficacy only lists the non-neutral cells.
  const matrix: number[][] = TYPE_ORDER.map(() => TYPE_ORDER.map(() => 1))
  for (const r of csv.type_efficacy) {
    const a = typeIndexById.get(r.damage_type_id!)
    const d = typeIndexById.get(r.target_type_id!)
    if (a === undefined || d === undefined) continue
    matrix[a]![d] = Number(r.damage_factor) / 100
  }

  // --- moves ---------------------------------------------------------------

  const enMoveName = new Map<string, string>()
  for (const r of csv.move_names) {
    if (r.local_language_id === String(EN)) enMoveName.set(r.move_id!, r.name!)
  }

  type Move = { n: string; t: number; p: number; c: 'physical' | 'special' }
  const moves: Move[] = []
  /** move_id -> index in `moves`, for learnset compaction. */
  const moveIndexById = new Map<string, number>()

  for (const r of csv.moves) {
    const id = r.id!
    if (Number(id) >= 10000) continue
    const cls = r.damage_class_id
    if (cls !== PHYSICAL && cls !== SPECIAL) continue
    const t = typeIndexById.get(r.type_id!)
    if (t === undefined) continue
    moveIndexById.set(id, moves.length)
    moves.push({
      n: enMoveName.get(id) ?? titleCase(r.identifier!),
      t,
      p: Number(r.power) || 0, // power 0 == variable/fixed damage
      c: cls === PHYSICAL ? 'physical' : 'special',
    })
  }

  const vanillaMoveCount = moves.length

  // Pseudo-moves so hacks that retype or rename moves stay usable.
  const pseudoFrom = moves.length
  typeNames.forEach((name, t) => {
    moves.push({ n: `Any ${name} move`, t, p: 80, c: 'physical' })
  })

  // --- species and forms ---------------------------------------------------

  const typesByPokemon = groupBy(csv.pokemon_types, 'pokemon_id')
  const statsByPokemon = groupBy(csv.pokemon_stats, 'pokemon_id')
  const abilitiesByPokemon = groupBy(csv.pokemon_abilities, 'pokemon_id')

  const enSpeciesName = new Map<string, string>()
  for (const r of csv.pokemon_species_names) {
    if (r.local_language_id === String(EN)) enSpeciesName.set(r.pokemon_species_id!, r.name!)
  }
  const enAbilityName = new Map<string, string>()
  for (const r of csv.ability_names) {
    if (r.local_language_id === String(EN)) enAbilityName.set(r.ability_id!, r.name!)
  }

  function typesOf(pokemonId: string): number[] | null {
    const rows = typesByPokemon.get(pokemonId)
    if (!rows?.length) return null
    const out = [...rows]
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map((r) => typeIndexById.get(r.type_id!))
      .filter((t): t is number => t !== undefined)
    return out.length ? out : null
  }

  type Entry = {
    n: string
    t: number[]
    s: number[]
    ab: string[]
    hab: string[]
    sp: number
    id: number
  }
  const dex: Entry[] = []

  function push(pokemonId: string, name: string, types: number[]): void {
    const statRows = statsByPokemon.get(pokemonId) ?? []
    const s = [0, 0, 0, 0, 0, 0]
    for (const r of statRows) {
      const slot = STAT_SLOT[r.stat_id!]
      if (slot !== undefined) s[slot] = Number(r.base_stat)
    }

    const ab: string[] = []
    const hab: string[] = []
    const abilityRows = [...(abilitiesByPokemon.get(pokemonId) ?? [])]
      .sort((a, b) => Number(a.slot) - Number(b.slot))
    for (const r of abilityRows) {
      const n = enAbilityName.get(r.ability_id!) ?? ''
      if (!n) continue
      if (r.is_hidden === '1') hab.push(n)
      else ab.push(n)
    }

    const row = csv.pokemon.find((p) => p.id === pokemonId)
    dex.push({ n: name, t: types, s, ab, hab, sp: Number(row?.species_id ?? 0), id: Number(pokemonId) })
  }

  // Base forms: ids 1..1025.
  const baseTypesBySpecies = new Map<string, string>()
  for (const p of csv.pokemon) {
    const id = Number(p.id)
    if (id < 1 || id > 1025) continue
    const types = typesOf(p.id!)
    if (!types) continue
    baseTypesBySpecies.set(p.species_id!, types.join(','))
    push(p.id!, enSpeciesName.get(p.species_id!) ?? titleCase(p.identifier!), types)
  }

  // Alternate forms, but only where the type pair actually differs — a Mega
  // with the same typing adds nothing to a type-based planner.
  for (const p of csv.pokemon) {
    const id = Number(p.id)
    if (id <= 10000) continue
    const identifier = p.identifier ?? ''
    if (identifier.includes('-gmax')) continue
    const types = typesOf(p.id!)
    if (!types) continue
    const baseKey = baseTypesBySpecies.get(p.species_id!)
    if (baseKey === undefined || baseKey === types.join(',')) continue

    const baseName = enSpeciesName.get(p.species_id!) ?? ''
    const baseSlug = csv.pokemon.find(
      (q) => q.species_id === p.species_id && Number(q.id) <= 1025,
    )?.identifier
    // Prefer the base form's own identifier, but some base forms carry a
    // suffix themselves (wormadam-plant, shaymin-land), so fall back to the
    // species name slugified.
    const name = baseName
      ? `${baseName} (${titleCase(formSuffix(identifier, baseSlug, baseName))})`
      : titleCase(identifier)
    push(p.id!, name, types)
  }

  dex.sort((a, b) => a.id - b.id)

  // --- learnsets -----------------------------------------------------------

  // Union across every version group; a hack can teach anything the species
  // ever learned, so version-group fidelity would only lose us options.
  const learnByPokemon = new Map<number, Set<number>>()
  for (const r of csv.pokemon_moves) {
    const mi = moveIndexById.get(r.move_id!)
    if (mi === undefined) continue
    const pid = Number(r.pokemon_id)
    const set = learnByPokemon.get(pid)
    if (set) set.add(mi)
    else learnByPokemon.set(pid, new Set([mi]))
  }

  // Forms with no rows of their own inherit the base species' set.
  const baseIdBySpecies = new Map<number, number>()
  for (const e of dex) {
    if (e.id <= 1025) baseIdBySpecies.set(e.sp, e.id)
  }

  const learnsets: number[][] = dex.map((e) => {
    const own = learnByPokemon.get(e.id)
    if (own?.size) return [...own].sort((a, b) => a - b)
    const baseId = baseIdBySpecies.get(e.sp)
    const inherited = baseId === undefined ? undefined : learnByPokemon.get(baseId)
    return inherited ? [...inherited].sort((a, b) => a - b) : []
  })

  // --- natures -------------------------------------------------------------

  const enNatureName = new Map<string, string>()
  for (const r of csv.nature_names) {
    if (r.local_language_id === String(EN)) enNatureName.set(r.nature_id!, r.name!)
  }
  const natures = csv.natures.map((r) => {
    const up = STAT_SLOT[r.increased_stat_id!]
    const down = STAT_SLOT[r.decreased_stat_id!]
    const neutral = up === undefined || down === undefined || up === down
    return {
      n: enNatureName.get(r.id!) ?? titleCase(r.identifier!),
      up: neutral ? null : up,
      down: neutral ? null : down,
    }
  })
  natures.sort((a, b) => a.n.localeCompare(b.n))

  // --- write ---------------------------------------------------------------

  const counts = {
    dex: dex.length,
    moves: moves.length,
    vanillaMoves: vanillaMoveCount,
    pseudoMoves: moves.length - pseudoFrom,
    natures: natures.length,
    learnsetEntries: learnsets.reduce((n, l) => n + l.length, 0),
  }

  const outputs: Record<string, unknown> = {
    'typechart.json': { types: typeNames, matrix },
    'dex.json': dex.map(({ n, t, s, ab, hab }) => ({ n, t, s, ab, hab })),
    'moves.json': moves,
    'learnsets.json': learnsets,
    'natures.json': natures,
    'meta.json': {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: 'PokeAPI/pokeapi data/v2/csv',
      sourceCommit: await sourceCommit(),
      counts,
    },
  }

  for (const [file, value] of Object.entries(outputs)) {
    await writeFile(join(OUT, file), JSON.stringify(value))
  }

  console.log('\nWrote data/:')
  for (const [file] of Object.entries(outputs)) {
    const bytes = (await readFile(join(OUT, file))).byteLength
    console.log(`  ${file.padEnd(18)} ${(bytes / 1024).toFixed(1)} KB`)
  }
  console.log('\nCounts:', counts)

  if (natures.length !== 25) console.warn(`WARNING: expected 25 natures, got ${natures.length}`)
  if (counts.pseudoMoves !== 18) console.warn(`WARNING: expected 18 pseudo-moves`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
