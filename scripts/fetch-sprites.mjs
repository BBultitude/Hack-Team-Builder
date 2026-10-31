/**
 * Downloads Pokemon sprites into public/sprites so the site serves its own
 * (no requests to outside hosts, and offline once seen). Run by the Docker
 * build; the layer only re-runs when data/dex.json or this script changes.
 *
 *   node scripts/fetch-sprites.mjs
 *
 * Existing files are skipped, so re-runs only fetch what is new. A missing
 * sprite is logged, not fatal: the app hides images that fail to load.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'sprites')
const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
/** Gen 3 setups show Emerald's sprites for the first 386, matching the game being played. */
const GEN3_LAST = 386
const PARALLEL = 16

const dex = JSON.parse(await readFile(join(ROOT, 'data', 'dex.json'), 'utf8'))
const jobs = []
for (const { id } of dex) {
  jobs.push({ url: `${BASE}/${id}.png`, file: join(OUT, `${id}.png`) })
  if (id <= GEN3_LAST) {
    jobs.push({ url: `${BASE}/versions/generation-iii/emerald/${id}.png`, file: join(OUT, 'g3', `${id}.png`) })
  }
}

await mkdir(join(OUT, 'g3'), { recursive: true })

const exists = (f) => access(f).then(() => true, () => false)
let fetched = 0
let skipped = 0
const missing = []

async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    if (await exists(job.file)) {
      skipped++
      continue
    }
    try {
      const res = await fetch(job.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await writeFile(job.file, Buffer.from(await res.arrayBuffer()))
      fetched++
    } catch (e) {
      missing.push(`${job.url} (${e.message})`)
    }
  }
}

await Promise.all(Array.from({ length: PARALLEL }, worker))
console.log(`Sprites: ${fetched} downloaded, ${skipped} already present, ${missing.length} missing.`)
for (const m of missing.slice(0, 20)) console.log(`  missing ${m}`)
