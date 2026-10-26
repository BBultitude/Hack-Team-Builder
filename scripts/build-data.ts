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
  'pokemon_species',
  'pokemon_evolution',
  'pokemon_forms',
  'evolution_triggers',
  'item_names',
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

/** Status and utility moves the catching advice cares about; see src/logic/catching.ts. */
const CATCH_MOVES = [
  'false-swipe',
  'spore', 'sleep-powder', 'hypnosis', 'sing', 'lovely-kiss', 'grass-whistle', 'yawn', 'dark-void',
  'thunder-wave', 'stun-spore', 'glare',
]

/** Below this capture rate across a line's catchable stages, it is not a realistic target. */
const MIN_CAPTURE_RATE = 30

/** Ultra Beasts and Paradox Pokemon: not flagged legendary by PokeAPI, but still one-off or endgame-only. */
const SPECIAL_ENCOUNTERS = new Set([
  793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806,
  984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 1005, 1006, 1009, 1010,
  1020, 1021, 1022, 1023,
])

/** Regional forms are ordinary wild Pokemon; other alternate forms (Megas etc.) are not catchable. */
const REGIONAL = /-(alola|galar|hisui|paldea)/

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
    slug: string
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
    dex.push({
      n: name, t: types, s, ab, hab,
      sp: Number(row?.species_id ?? 0), id: Number(pokemonId), slug: row?.identifier ?? '',
    })
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

  // --- evolution, obtainability, catch moves -----------------------------

  const speciesById = new Map(csv.pokemon_species.map((r) => [Number(r.id), r]))
  const parentOf = (sp: number): number => Number(speciesById.get(sp)?.evolves_from_species_id) || 0
  const baseIndexBySpecies = new Map<number, number>()
  dex.forEach((e, i) => { if (e.id <= 1025) baseIndexBySpecies.set(e.sp, i) })
  const isRegional = (e: Entry): boolean => e.id > 10000 && REGIONAL.test(e.slug)
  const suffixOf = (e: Entry): string => REGIONAL.exec(e.slug)?.[1] ?? ''

  // How each evolution happens, in words. PokeAPI has a row per game, so the
  // distinct methods are joined: "use a Leaf Stone, or level up near a Moss Rock".
  const enItemName = new Map<string, string>()
  for (const r of csv.item_names) {
    if (r.local_language_id === String(EN)) enItemName.set(r.item_id!, r.name!)
  }
  const triggerSlug = new Map(csv.evolution_triggers.map((r) => [r.id!, r.identifier!]))
  const describeEvolution = (r: Record<string, string>): string => {
    const trigger = triggerSlug.get(r.evolution_trigger_id!) ?? ''
    const name = (id: string | undefined): string => enItemName.get(id ?? '') ?? 'item'
    const item = (id: string | undefined): string => `${/^[AEIOU]/.test(name(id)) ? 'an' : 'a'} ${name(id)}`
    const parts: string[] = []
    if (trigger === 'level-up') parts.push(r.minimum_level ? `level ${r.minimum_level}` : 'level up')
    else if (trigger === 'trade') parts.push('trade')
    else if (trigger === 'use-item') parts.push(`use ${item(r.trigger_item_id)}`)
    else if (trigger === 'gimmighoul-coins') parts.push('level up with 999 Gimmighoul Coins')
    else if (trigger === 'shed') parts.push('have a free party slot and a spare Poké Ball when Nincada evolves')
    else parts.push(titleCase(trigger).toLowerCase())
    if (r.held_item_id) parts.push(`holding ${item(r.held_item_id)}`)
    if (r.trade_species_id) parts.push(`for ${enSpeciesName.get(r.trade_species_id) ?? 'a specific Pokémon'}`)
    if (r.minimum_happiness) parts.push('with high friendship')
    if (r.minimum_affection) parts.push('with high affection')
    if (r.minimum_beauty) parts.push('with high Beauty')
    if (r.known_move_id) parts.push(`knowing ${enMoveName.get(r.known_move_id) ?? 'a specific move'}`)
    if (r.known_move_type_id) parts.push(`knowing a ${typeNames[typeIndexById.get(r.known_move_type_id) ?? -1] ?? ''}-type move`)
    if (r.party_species_id) parts.push(`with ${enSpeciesName.get(r.party_species_id) ?? 'a specific Pokémon'} in the party`)
    if (r.party_type_id) parts.push(`with a ${typeNames[typeIndexById.get(r.party_type_id) ?? -1] ?? ''}-type in the party`)
    if (r.time_of_day) parts.push(r.time_of_day === 'night' ? 'at night' : `during the ${r.time_of_day}`)
    if (r.gender_id) parts.push(r.gender_id === '1' ? '(female)' : '(male)')
    if (r.relative_physical_stats) {
      parts.push({ '1': 'with Attack above Defense', '-1': 'with Defense above Attack', '0': 'with Attack equal to Defense' }[r.relative_physical_stats] ?? '')
    }
    if (r.location_id) parts.push('at a special location')
    if (r.needs_overworld_rain === '1') parts.push('in the rain')
    if (r.turn_upside_down === '1') parts.push('with the console upside down')
    return parts.filter(Boolean).join(' ')
  }
  // Evolution links between dex entries. Rows name the exact forms when it
  // matters (Alolan Vulpix -> Alolan Ninetales); a row without forms links
  // the base forms. Megas and other battle forms never evolve.
  const indexById = new Map(dex.map((e, i) => [e.id, i]))
  const pokemonByForm = new Map(csv.pokemon_forms.map((r) => [r.id!, Number(r.pokemon_id)]))
  const speciesByPokemon = new Map(csv.pokemon.map((r) => [Number(r.id), Number(r.species_id)]))
  const resolve = (formId: string | undefined, species: number): number | undefined => {
    const pid = formId ? pokemonByForm.get(formId) : undefined
    const idx = pid === undefined ? undefined : indexById.get(pid)
    const e = idx === undefined ? undefined : dex[idx]
    if (e && (e.id <= 1025 || isRegional(e))) return idx
    // Forms that share the base typing are not in the dex; use the base.
    return baseIndexBySpecies.get(pid === undefined ? species : speciesByPokemon.get(pid) ?? species)
  }
  const howByEdge = new Map<string, string[]>()
  const ev: number[][] = dex.map(() => [])
  const parentIdx = new Map<number, number>()
  for (const r of csv.pokemon_evolution) {
    const childSp = Number(r.evolved_species_id)
    const from = resolve(r.required_pokemon_form_id, parentOf(childSp))
    const to = resolve(r.evolved_pokemon_form_id, childSp)
    if (from === undefined || to === undefined) continue
    if (!ev[from]!.includes(to)) ev[from]!.push(to)
    if (!parentIdx.has(to)) parentIdx.set(to, from)
    const key = `${from}>${to}`
    const list = howByEdge.get(key) ?? []
    const text = describeEvolution(r)
    if (!list.includes(text)) list.push(text)
    howByEdge.set(key, list)
  }
  // Regional forms PokeAPI gives no rows for evolve into the same region's form.
  dex.forEach((e, i) => {
    if (!isRegional(e) || ev[i]!.length) return
    dex.forEach((c, j) => {
      if (parentOf(c.sp) !== e.sp || suffixOf(c) !== suffixOf(e)) return
      ev[i]!.push(j)
      if (!parentIdx.has(j)) parentIdx.set(j, i)
      howByEdge.set(`${i}>${j}`, howByEdge.get(`${baseIndexBySpecies.get(e.sp)}>${baseIndexBySpecies.get(c.sp)}`) ?? [])
    })
  })
  for (const list of ev) list.sort((a, b) => a - b)
  const howToEvolve = (from: number, to: number): string =>
    (howByEdge.get(`${from}>${to}`) ?? []).join(', or ') || 'special conditions'

  // Where to catch each entry from: the easiest earlier stage, the earliest
  // on ties since final stages are rarely found in the wild.
  const captureRate = (sp: number): number => Number(speciesById.get(sp)?.capture_rate) || 0
  const catchFrom: number[] = dex.map((e, i) => {
    let best = i
    let bestRate = captureRate(e.sp)
    const seen = new Set([i])
    for (let at = parentIdx.get(i); at !== undefined && !seen.has(at); at = parentIdx.get(at)) {
      seen.add(at)
      const rate = captureRate(dex[at]!.sp)
      // Baby stages come from eggs, so only point at one when it is strictly easier.
      const baby = speciesById.get(dex[at]!.sp)?.is_baby === '1'
      if (baby ? rate > bestRate : rate >= bestRate) { best = at; bestRate = rate }
    }
    return best
  })

  const rareChains = new Set<string>()
  for (const r of csv.pokemon_species) {
    if (r.is_legendary === '1' || r.is_mythical === '1' || SPECIAL_ENCOUNTERS.has(Number(r.id))) {
      rareChains.add(r.evolution_chain_id!)
    }
  }
  const chainOf = (sp: number): number => Number(speciesById.get(sp)?.evolution_chain_id) || 0
  const obtainable = (e: Entry, i: number): boolean =>
    (e.id <= 1025 || isRegional(e)) &&
    !rareChains.has(String(chainOf(e.sp))) &&
    captureRate(dex[catchFrom[i]!]!.sp) >= MIN_CAPTURE_RATE

  // Learners of each catch-helper move, by dex index, forms inheriting as above.
  const catchMoves: Record<string, number[]> = {}
  for (const slug of CATCH_MOVES) {
    const row = csv.moves.find((m) => m.identifier === slug)
    if (!row) throw new Error(`missing move ${slug}`)
    const learners = new Set<number>()
    for (const r of csv.pokemon_moves) if (r.move_id === row.id) learners.add(Number(r.pokemon_id))
    const name = enMoveName.get(row.id!) ?? titleCase(slug)
    catchMoves[name] = dex
      .map((e, i) => ({ e, i }))
      .filter(({ e }) =>
        learners.has(e.id) ||
        (!learnByPokemon.get(e.id)?.size && learners.has(baseIdBySpecies.get(e.sp) ?? -1)))
      .map(({ i }) => i)
  }

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
    'dex.json': dex.map((e, i) => ({
      n: e.n, t: e.t, s: e.s, ab: e.ab, hab: e.hab,
      cr: captureRate(e.sp),
      fm: chainOf(e.sp),
      ...(ev[i]!.length ? { ev: ev[i], eh: ev[i]!.map((c) => howToEvolve(i, c)) } : {}),
      ...(obtainable(e, i) ? { ok: 1, cf: catchFrom[i] } : {}),
    })),
    'catch.json': catchMoves,
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
