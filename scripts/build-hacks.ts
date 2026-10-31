/**
 * Build-time hack data packs: data/hacks/<hack>.json.
 *
 * Reads each hack's own community sources (the ones romhackdex.net credits),
 * pinned to a commit, and writes only what differs from the vanilla data in
 * data/: changed species, forms the vanilla dex lacks, extra level-up moves,
 * and boss teams. Everything is keyed by name, so a pack survives a
 * regeneration of the vanilla data. Run `npm run build:data` first.
 *
 * Usage: npm run build:hacks
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DexEntry, HackPack, Move, Nature, TrainerMon, TypeChart } from '../src/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CACHE = join(HERE, '.cache', 'hacks')
const DATA = join(ROOT, 'data')
const OUT = join(DATA, 'hacks')

const RAW = 'https://raw.githubusercontent.com'
const UNBOUND = { repo: 'Skeli789/Dynamic-Pokemon-Expansion', sha: 'fe058e0e3ac23cf968cf950de43332135bc1549d' }
const UNBOUND_CALC = { repo: 'Owakeningowl/unbound-calc', sha: '1192051808347344df2f6fe4db38a5ad74127c11' }
const BORRIUS = { repo: 'nMckenryan/Borrius-Pokedex-Scraper', sha: '4ba3093797afd9192b5d01382378b55dfe5bdc17' }
const ROGUE = { repo: 'Pokabbie/pokeemerald-rogue', sha: '559792325f500d480b892799218ee015962f93a2' }

/** Above this share of unmapped species, the build fails rather than ship a half-wrong pack. */
const MAX_UNMATCHED = 0.02

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function source(src: { repo: string; sha: string }, path: string): Promise<string> {
  const cached = join(CACHE, src.sha.slice(0, 12), path.replace(/[\\/ ]/g, '_'))
  if (!(await exists(cached))) {
    process.stdout.write(`  downloading ${src.repo}/${path} ... `)
    const res = await fetch(`${RAW}/${src.repo}/${src.sha}/${encodeURI(path)}`)
    if (!res.ok) throw new Error(`${src.repo}/${path}: HTTP ${res.status}`)
    await mkdir(dirname(cached), { recursive: true })
    await writeFile(cached, await res.text())
    process.stdout.write('done\n')
  }
  return readFile(cached, 'utf8')
}

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(join(DATA, file), 'utf8')) as T

const REGION_ADJECTIVES: Record<string, string> = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' }

/**
 * "Ninetales (Alola)", "NINETALES_ALOLA", "Ninetales-Alola" and "Alolan Ninetales" all become
 * "ninetalesalola"; accents drop (Flabébé) and Nidoran's ♂/♀ become m/f.
 */
export const key = (s: string): string => {
  const region = /^(alolan|galarian|hisuian|paldean)\s+(.+)$/i.exec(s.trim())
  const name = region ? `${region[2]} ${REGION_ADJECTIVES[region[1]!.toLowerCase()]}` : s
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/♂/g, 'm')
    .replace(/♀/g, 'f')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Decomp constants abbreviate regional forms: NINETALES_A, DARMANITAN_G_ZEN. */
function speciesKey(constant: string): string {
  return key(
    constant
      .replace(/^SPECIES_/, '')
      .replace(/_A(?=_|$)/, '_ALOLA')
      .replace(/_G(?=_|$)/, '_GALAR')
      .replace(/_H(?=_|$)/, '_HISUI')
      .replace(/_P(?=_|$)/, '_PALDEA'),
  )
}

/**
 * Keeps the first branch of every #if and drops #elif/#else branches. The
 * first branch is the newest-generation value in these sources
 * (`#if P_UPDATED_STATS >= GEN_7`), which is what a modern hack ships.
 */
export function firstBranches(text: string): string {
  const keep: boolean[] = []
  const out: string[] = []
  for (const line of text.split('\n')) {
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/.exec(line)?.[1]
    if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') keep.push(true)
    else if (directive === 'elif' || directive === 'else') keep[keep.length - 1] = false
    else if (directive === 'endif') keep.pop()
    else if (keep.every(Boolean)) out.push(line)
  }
  return out.join('\n')
}

/** `[SPECIES_X] = { ... }` blocks, keyed by the constant. Nested braces are fine; blocks end at a line that is just `},`. */
function speciesBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string>()
  const re = /\[(SPECIES_[A-Z0-9_]+)\]\s*=\s*\{([\s\S]*?)\n\s*\},/g
  for (const m of text.matchAll(re)) blocks.set(m[1]!, m[2]!)
  return blocks
}

/**
 * Expands object-like #defines (family types, *_MISC_INFO blocks) in place,
 * taking the first, newer arm of `(P_UPDATED_TYPES >= GEN_6 ? TYPE_FAIRY : TYPE_NORMAL)`.
 */
export function expandMacros(text: string): (block: string) => string {
  const joined = text.replace(/\\\n/g, ' ')
  const defines = new Map([...joined.matchAll(/^\s*#define\s+([A-Z][A-Z0-9_]+)[ \t]+(.+)$/gm)].map((m) => [m[1]!, m[2]!]))
  const once = (b: string): string => b.replace(/\b[A-Z][A-Z0-9_]+\b/g, (w) => defines.get(w) ?? w)
  return (block) => once(once(block)).replace(/\([^?()]*\?\s*([^:()]+?)\s*:[^()]*\)/g, '$1')
}

const field = (block: string, name: string): string | undefined =>
  new RegExp(`\\.${name}\\s*=\\s*(\\{[^}]*\\}|\\w+\\([^)]*\\)|[^,\\n]+)`).exec(block)?.[1]?.trim()

interface Species {
  t: number[]
  s: number[]
  ab: string[]
  hab: string[]
  cr?: number
}

interface Context {
  chart: TypeChart
  dex: DexEntry[]
  dexByKey: Map<string, number>
  abilityByKey: Map<string, string>
  moveByKey: Map<string, Move>
  /** Every English move name, status moves included, for the unmatched check. */
  allMoves: Set<string>
  unmatched: Set<string>
}

function typeOf(ctx: Context, constant: string): number | undefined {
  // The ??? type has no matchups; species with it keep their other type.
  if (!constant || constant === 'TYPE_MYSTERY') return undefined
  const i = ctx.chart.types.findIndex((t) => key(t) === key(constant.replace(/^TYPE_/, '')))
  if (i < 0) ctx.unmatched.add(constant)
  return i < 0 ? undefined : i
}

function abilityOf(ctx: Context, constant: string): string {
  if (!constant || /ABILITY_NONE$/.test(constant)) return ''
  // Both riders' As One share one name in the games' ability list.
  if (/^ABILITY_AS_?ONE/.test(constant)) return 'As One'
  const name = ctx.abilityByKey.get(key(constant.replace(/^ABILITY_/, '')))
  if (!name) ctx.unmatched.add(constant)
  return name ?? ''
}

function species(ctx: Context, block: string): Species | null {
  const stat = (n: string): number => Number(field(block, n))
  const s = ['baseHP', 'baseAttack', 'baseDefense', 'baseSpAttack', 'baseSpDefense', 'baseSpeed'].map(stat)
  if (s.some((v) => !Number.isFinite(v))) return null

  let typeNames: string[]
  const types = field(block, 'types')
  if (types) {
    typeNames = types.match(/TYPE_[A-Z]+/g) ?? []
  } else {
    typeNames = [field(block, 'type1') ?? '', field(block, 'type2') ?? '']
  }
  const t = [...new Set(typeNames.map((n) => typeOf(ctx, n)).filter((n): n is number => n !== undefined))]
  if (!t.length) return null

  let abilities: string[]
  const list = field(block, 'abilities')
  if (list) abilities = (list.match(/ABILITY_[A-Z0-9_]+/g) ?? []).map((a) => abilityOf(ctx, a))
  else abilities = ['ability1', 'ability2', 'hiddenAbility'].map((f) => abilityOf(ctx, field(block, f) ?? 'ABILITY_NONE'))
  const regular = [...new Set([abilities[0], abilities[1]].filter((a): a is string => !!a))]
  const hidden = abilities[2] && !regular.includes(abilities[2]) ? [abilities[2]] : []
  const cr = Number(field(block, 'catchRate'))
  return { t, s, ab: regular, hab: hidden, ...(cr > 0 ? { cr } : {}) }
}

const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** Species that differ from vanilla, by dex name. Unknown forms are kept aside for trainers to claim. */
function diffSpecies(ctx: Context, blocks: Map<string, string>, pack: HackPack, forms: Map<string, Species>): number {
  let parsed = 0
  for (const [constant, block] of blocks) {
    const sp = species(ctx, block)
    if (!sp) continue
    parsed++
    const k = speciesKey(constant)
    const i = ctx.dexByKey.get(k)
    if (i === undefined) {
      forms.set(k, sp)
      continue
    }
    const v = ctx.dex[i]!
    const change: HackPack['dex'][string] = {}
    // Type order doesn't change any matchup, so a swap isn't a change.
    if (!same([...sp.t].sort(), [...v.t].sort())) change.t = sp.t
    if (!same(sp.s, v.s)) change.s = sp.s
    if (!same(sp.ab, v.ab)) change.ab = sp.ab
    if (!same(sp.hab, v.hab)) change.hab = sp.hab
    if (sp.cr !== undefined && sp.cr !== v.cr) change.cr = sp.cr
    if (Object.keys(change).length) pack.dex[v.n] = change
  }
  return parsed
}

/** The dex name a trainer's species maps to, adding a form entry when only the hack has it. */
function claimSpecies(ctx: Context, calcName: string, forms: Map<string, Species>, pack: HackPack): string | null {
  const k = key(calcName)
  const i = ctx.dexByKey.get(k)
  if (i !== undefined) return ctx.dex[i]!.n
  const form = forms.get(k)
  const [baseName, ...rest] = calcName.split('-')
  const base = ctx.dexByKey.get(key(baseName ?? ''))
  if (!form || base === undefined || !rest.length) {
    ctx.unmatched.add(calcName)
    return null
  }
  const name = `${ctx.dex[base]!.n} (${rest.join(' ')})`
  pack.dex[name] = { ...form, base: ctx.dex[base]!.n }
  return name
}

/** Showdown-calc set files are JavaScript object literals; parsed as text, never run. */
export function parseSets(text: string): Record<string, Record<string, Record<string, unknown>>> {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1).replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(body) as Record<string, Record<string, Record<string, unknown>>>
}

const STAT_KEYS = ['hp', 'at', 'df', 'sa', 'sd', 'sp']

function spread(raw: unknown, fallback: number): number[] {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return STAT_KEYS.map((k) => (typeof o[k] === 'number' ? (o[k] as number) : fallback))
}

function trainers(
  ctx: Context,
  text: string,
  order: Record<string, string[]>,
  forms: Map<string, Species>,
  pack: HackPack,
  natures: Nature[],
): NonNullable<HackPack['trainers']>[string] {
  const byTrainer = new Map<string, { mon: TrainerMon; calcName: string }[]>()
  for (const [calcName, sets] of Object.entries(parseSets(text))) {
    const n = claimSpecies(ctx, calcName, forms, pack)
    if (!n) continue
    for (const [trainer, set] of Object.entries(sets)) {
      const moves = Array.isArray(set.moves) ? (set.moves as unknown[]).map(String).filter(Boolean) : []
      for (const m of moves) if (!ctx.allMoves.has(key(m))) ctx.unmatched.add(`move ${m}`)
      const nature = String(set.nature ?? '')
      const mon: TrainerMon = {
        n,
        lv: Number(set.level) || 50,
        ab: String(set.ability ?? ''),
        it: String(set.item ?? ''),
        nt: natures.some((x) => x.n === nature) ? nature : '',
        ev: spread(set.evs, 0),
        iv: spread(set.ivs, 31),
        mv: moves,
      }
      const list = byTrainer.get(trainer) ?? []
      list.push({ mon, calcName })
      byTrainer.set(trainer, list)
    }
  }
  return [...byTrainer]
    .map(([name, team]) => {
      // team-order keys are lower case with [] for ().
      const party = order[name.toLowerCase().replace(/\(/g, '[').replace(/\)/g, ']')]
      const rank = (c: string): number => (party?.indexOf(c) ?? -1) < 0 ? 99 : party!.indexOf(c)
      return { name, team: team.sort((a, b) => rank(a.calcName) - rank(b.calcName)).map((x) => x.mon) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** LEVEL_UP_MOVE entries per species, as move names this app knows that vanilla doesn't already teach. */
function extraLevelUp(ctx: Context, text: string, learnsets: number[][], moves: Move[]): Record<string, string[]> {
  const lists = new Map<string, string[]>()
  for (const m of text.matchAll(/(s\w+LevelUpLearnset)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    lists.set(m[1]!, [...m[2]!.matchAll(/LEVEL_UP_MOVE\(\s*\d+\s*,\s*(MOVE_[A-Z0-9_]+)\)/g)].map((x) => x[1]!))
  }
  const out: Record<string, string[]> = {}
  for (const m of text.matchAll(/\[(SPECIES_[A-Z0-9_]+)\]\s*=\s*(s\w+LevelUpLearnset)/g)) {
    const i = ctx.dexByKey.get(speciesKey(m[1]!))
    if (i === undefined) continue
    const known = new Set((learnsets[i] ?? []).map((j) => moves[j]?.n))
    const extra = (lists.get(m[2]!) ?? [])
      .map((c) => ctx.moveByKey.get(key(c.replace(/^MOVE_/, '')))?.n)
      .filter((n): n is string => !!n && !known.has(n))
    if (extra.length) out[ctx.dex[i]!.n] = [...new Set(extra)]
  }
  return out
}

function check(name: string, ctx: Context, speciesCount: number): void {
  const species = [...ctx.unmatched].filter((u) => !/^(move |obtain |ABILITY_)/.test(u))
  console.log(`  ${name}: ${speciesCount} species parsed, ${ctx.unmatched.size} unmatched`)
  if (ctx.unmatched.size) console.log(`    ${[...ctx.unmatched].slice(0, 40).join(', ')}${ctx.unmatched.size > 40 ? ', ...' : ''}`)
  if (species.length > speciesCount * MAX_UNMATCHED) {
    throw new Error(`${name}: ${species.length} unmatched species is over ${MAX_UNMATCHED * 100}%; fix the name mapping`)
  }
}

async function main(): Promise<void> {
  const [chart, dex, moves, learnsets, natures] = await Promise.all([
    readJson<TypeChart>('typechart.json'),
    readJson<DexEntry[]>('dex.json'),
    readJson<Move[]>('moves.json'),
    readJson<number[][]>('learnsets.json'),
    readJson<Nature[]>('natures.json'),
  ])
  // English names from the PokeAPI CSVs build-data cached; status moves aren't in moves.json.
  const english = async (file: string): Promise<string[]> =>
    (await readFile(join(HERE, '.cache', file), 'utf8'))
      .split('\n')
      .map((l) => l.split(','))
      .filter((c) => c[1] === '9')
      .map((c) => c.slice(2).join(',').replace(/^"|"$/g, ''))
  const abilityNames = await english('ability_names.csv')
  const allMoves = new Set((await english('move_names.csv')).map(key))

  const context = (): Context => ({
    chart,
    dex,
    dexByKey: new Map(dex.map((d, i) => [key(d.n), i])),
    abilityByKey: new Map(abilityNames.map((n) => [key(n), n])),
    moveByKey: new Map(moves.map((m) => [key(m.n), m])),
    allMoves,
    unmatched: new Set(),
  })
  await mkdir(OUT, { recursive: true })

  // ------------------------------------------------------------ Unbound
  {
    const ctx = context()
    const pack: HackPack = {
      name: 'Pokémon Unbound',
      source: `${UNBOUND.repo}@${UNBOUND.sha.slice(0, 12)} (Unbound branch), boss teams from ${UNBOUND_CALC.repo}@${UNBOUND_CALC.sha.slice(0, 12)}, locations from ${BORRIUS.repo}@${BORRIUS.sha.slice(0, 12)}`,
      gen: 8,
      dex: {},
      unmatched: [],
    }
    const forms = new Map<string, Species>()
    const count = diffSpecies(ctx, speciesBlocks(await source(UNBOUND, 'src/Base_Stats.c')), pack, forms)
    pack.learn = extraLevelUp(ctx, await source(UNBOUND, 'src/Learnsets.c'), learnsets, moves)

    const orderText = await source(UNBOUND_CALC, 'js/data/team-order.js')
    const order = JSON.parse(orderText.slice(orderText.indexOf('{'), orderText.lastIndexOf('}') + 1)) as Record<string, string[]>
    pack.trainers = {}
    for (const difficulty of ['difficult', 'expert', 'insane']) {
      pack.trainers[difficulty] = trainers(ctx, await source(UNBOUND_CALC, `js/data/sets/${difficulty}.js`), order, forms, pack, natures)
    }
    // The calc maps Unbound's Vanilla difficulty to the Difficult sets; there is no Vanilla file.
    pack.difficulties = [
      { id: 'vanilla', label: 'Vanilla', sets: 'difficult', note: 'Uses the Difficult teams; Vanilla swaps a few moves and lowers levels.' },
      { id: 'difficult', label: 'Difficult', sets: 'difficult' },
      { id: 'expert', label: 'Expert', sets: 'expert' },
      { id: 'insane', label: 'Insane', sets: 'insane' },
    ]

    const regionalText = await source(UNBOUND, 'src/Pokedex_Orders.c')
    const regionalBlock = /gPokedexOrder_Regional\[\]\s*=\s*\{([\s\S]*?)\};/.exec(regionalText)?.[1] ?? ''
    pack.regional = [...regionalBlock.matchAll(/SPECIES_[A-Z0-9_]+/g)]
      .map((m) => {
        // Default forms carry a suffix the dex leaves off (MINIOR_SHIELD, BASCULIN_RED).
        const i = ctx.dexByKey.get(speciesKey(m[0])) ?? ctx.dexByKey.get(speciesKey(m[0].replace(/_[A-Z]+$/, '')))
        if (i === undefined) ctx.unmatched.add(m[0])
        return i === undefined ? '' : ctx.dex[i]!.n
      })
      .filter(Boolean)

    // Where to find each species in Unbound; a species missing here isn't obtainable.
    pack.obtain = {}
    for (const row of JSON.parse(await source(BORRIUS, 'scraperData/pokelocation.json')) as { name: string; location: string }[]) {
      const i = ctx.dexByKey.get(key(row.name))
      const name = i === undefined ? (pack.dex[row.name]?.base ? row.name : undefined) : ctx.dex[i]!.n
      if (!name) ctx.unmatched.add(`obtain ${row.name}`)
      else if (row.location?.trim()) pack.obtain[name] = row.location.trim()
    }

    pack.unmatched = [...ctx.unmatched]
    check('unbound', ctx, count)
    await writeFile(join(OUT, 'unbound.json'), JSON.stringify(pack))
  }

  // ------------------------------------------------------- Emerald Rogue
  {
    const ctx = context()
    // shortcut: species only. Rogue trainers are randomised and its learnsets are left vanilla; parse
    // src/data/pokemon/level_up_learnsets if Rogue starts changing them.
    const pack: HackPack = {
      name: 'Pokémon Emerald Rogue',
      source: `${ROGUE.repo}@${ROGUE.sha.slice(0, 12)} (EX-v2.1)`,
      gen: 9,
      dex: {},
      unmatched: [],
    }
    let count = 0
    for (let gen = 1; gen <= 9; gen++) {
      const text = firstBranches(await source(ROGUE, `src/data/pokemon/species_info/gen_${gen}.h`))
      const expand = expandMacros(text)
      const blocks = new Map([...speciesBlocks(text)].map(([k, b]) => [k, expand(b)]))
      count += diffSpecies(ctx, blocks, pack, new Map())
    }
    pack.unmatched = [...ctx.unmatched]
    check('rogue', ctx, count)
    await writeFile(join(OUT, 'rogue.json'), JSON.stringify(pack))
  }

  for (const file of ['unbound.json', 'rogue.json']) {
    const pack = JSON.parse(await readFile(join(OUT, file), 'utf8')) as HackPack
    const bytes = (await readFile(join(OUT, file))).byteLength
    const teams = Object.values(pack.trainers ?? {}).map((t) => t.length)
    console.log(`  ${file.padEnd(14)} ${(bytes / 1024).toFixed(1)} KB, ${Object.keys(pack.dex).length} species changed or added, trainers per difficulty: ${teams.join('/') || 'none'}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
