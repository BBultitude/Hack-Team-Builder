/**
 * End-to-end smoke test against a running server.
 *
 *   node scripts/smoke.mjs [url]     (default http://localhost:5173)
 *
 * Drives the app at phone size through the full flow in Design.md section 5.
 * Uses the system Chromium; set CHROME_PATH to override.
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/chromium'

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`)
})

const step = async (label, fn) => {
  try { await fn(); console.log(`PASS  ${label}`) }
  catch (e) { console.log(`FAIL  ${label}: ${e.message.split('\n')[0]}`); process.exitCode = 1 }
}

const addBox = 'input[placeholder*="Search by name"]'
const add = async (name) => {
  await page.fill(addBox, name)
  await page.locator(`.suggest-list button:text-is("${name}")`).click({ timeout: 10000 })
}

console.log(`Testing ${url}\n`)
await page.goto(url, { waitUntil: 'networkidle' })

await step('app renders', () => page.waitForSelector('h1:has-text("Hack Team Builder")', { timeout: 15000 }))

await step('dex data loaded', async () => {
  await page.fill(addBox, 'chari')
  await page.waitForSelector('.suggest-list button:has-text("Charizard")', { timeout: 5000 })
})

await step('picking a suggestion adds to roster and team', async () => {
  await page.click('.suggest-list button:has-text("Charizard")')
  await page.waitForSelector('h2:has-text("team 1/6")', { timeout: 5000 })
})

await step('add field clears after a pick', async () => {
  const v = await page.inputValue(addBox)
  if (v !== '') throw new Error(`expected empty field, got "${v}"`)
})

await step('adds eight Pokemon', async () => {
  for (const n of ['Blastoise', 'Venusaur', 'Gengar', 'Machamp', 'Lapras', 'Snorlax', 'Dragonite']) {
    await add(n)
  }
  await page.waitForSelector('text=Your Pokémon (8)', { timeout: 5000 })
})

await step('evolve keeps the slot and nature', async () => {
  await add('Eevee')
  await page.locator('.card:has-text("Eevee") button:has-text("Evolve → Vaporeon")').click()
  await page.waitForSelector('.editor-head:has-text("Vaporeon")', { timeout: 5000 })
  await page.waitForSelector('text=Your Pokémon (9)', { timeout: 5000 })
})

await step('remove needs a second tap', async () => {
  await page.locator('.card:has-text("Vaporeon") button:has-text("Remove Vaporeon")').click()
  await page.locator('button:has-text("Cancel")').click()
  await page.waitForSelector('text=Your Pokémon (9)', { timeout: 5000 })
  await page.locator('.card:has-text("Vaporeon") button:has-text("Remove Vaporeon")').click()
  await page.locator('button:has-text("Yes, remove")').click()
  await page.waitForSelector('text=Your Pokémon (8)', { timeout: 5000 })
})

await step('auto-build fills exactly six', async () => {
  await page.click('button[role="tab"]:has-text("Best Team")')
  await page.click('button:has-text("Auto-build")')
  await page.waitForSelector('h2:has-text("Team (6/6)")', { timeout: 5000 })
})

await step('defensive matrix covers all 18 types x 6 members', async () => {
  const rows = await page.locator('.matrix tbody tr').count()
  if (rows !== 18) throw new Error(`expected 18 rows, got ${rows}`)
  const cells = await page.locator('.matrix tbody tr').first().locator('td').count()
  if (cells !== 6) throw new Error(`expected 6 cells per row, got ${cells}`)
  const key = await page.locator('.matrix-key > li').count()
  if (key !== 6) throw new Error(`expected 6 key entries, got ${key}`)
})

await step('matrix fits inside its card with no overflow', async () => {
  const m = await page.evaluate(() => {
    const table = document.querySelector('.matrix')
    const card = table.closest('.card')
    return {
      table: table.scrollWidth,
      card: card.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  if (m.table > m.card) throw new Error(`matrix ${m.table}px overflows card ${m.card}px`)
  if (m.page > 0) throw new Error(`page scrolls ${m.page}px horizontally`)
})

await step('neutral cells carry no fill, weak and resist cells do', async () => {
  const counts = await page.evaluate(() => {
    const tds = [...document.querySelectorAll('.matrix tbody td')]
    return {
      total: tds.length,
      blank: tds.filter((td) => td.className === '' && td.textContent === '').length,
      filled: tds.filter((td) => td.className !== '').length,
      labelled: tds.filter((td) => td.className !== '' && td.textContent.trim() !== '').length,
    }
  })
  if (counts.total !== 108) throw new Error(`expected 108 cells, got ${counts.total}`)
  if (counts.blank === 0) throw new Error('no neutral cells left blank')
  // Every coloured cell must carry a glyph: colour is never the only encoding.
  if (counts.labelled !== counts.filled) {
    throw new Error(`${counts.filled - counts.labelled} coloured cells have no label`)
  }
  console.log(`        ${counts.filled} coloured, ${counts.blank} neutral of ${counts.total}`)
})

await step('tapping a cell explains it in words', async () => {
  await page.locator('.matrix tbody td.x2, .matrix tbody td.x4').first().click()
  const text = await page.locator('.matrix-readout').innerText()
  if (!/takes .* damage .* from /.test(text)) throw new Error(`unexpected readout: ${text}`)
  console.log(`        "${text}"`)
})

await step('team score is reported', async () => {
  const txt = await page.locator('text=/Team score/').first().innerText()
  if (!/Team score\s+-?\d/.test(txt)) throw new Error(`unexpected: ${txt}`)
  console.log(`        ${txt.replace(/\s+/g, ' ').trim()}`)
})

await step('recommends four moves per member', async () => {
  const lists = await page.locator('ol.moves').count()
  if (lists !== 6) throw new Error(`expected 6 move lists, got ${lists}`)
  const items = await page.locator('ol.moves').first().locator('li').count()
  if (items !== 4) throw new Error(`expected 4 moves, got ${items}`)
})

await step('look for lists catchable targets with a catch plan', async () => {
  await page.click('button[role="tab"]:has-text("Look For")')
  await page.waitForSelector('h2:has-text("Pokémon to look for")', { timeout: 5000 })
  await page.locator('summary:has-text("How to catch")').first().click()
  const plan = await page.locator('details[open] ol.moves').first().innerText()
  if (!/Quick Ball/.test(plan)) throw new Error(`unexpected plan: ${plan}`)
  console.log('        ' + plan.split('\n')[0])
})

await step('editing a move updates the member', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await page.locator('.card:has-text("Charizard") .editor-head').first().click()
  await page.locator('.card:has-text("Charizard") summary').first().click()
  const field = page.locator('.card:has-text("Charizard") input[placeholder^="Move"]').first()
  await field.fill('Earthquake')
  await page.locator('.suggest-list button:text-is("Earthquake")').click()
  if ((await field.inputValue()) !== 'Earthquake') throw new Error('move not applied')
  await page.locator('.card:has-text("Charizard") .editor-head').first().click()
})

await step('opponent tab ranks with reasons', async () => {
  await page.click('button[role="tab"]:has-text("Opponent")')
  await page.fill('input[placeholder*="Search the dex"]', 'Gengar')
  await page.locator('.suggest-list button:text-is("Gengar")').click()
  await page.waitForSelector('h2:has-text("Best:")', { timeout: 5000 })
  await page.waitForSelector('h2:has-text("Worst:")', { timeout: 5000 })
  await page.waitForSelector('h2:has-text("Full order")', { timeout: 5000 })
  const best = await page.locator('.card:has(h2:has-text("Best:"))').innerText()
  console.log('        ' + best.replace(/\n+/g, ' | ').slice(0, 220))
})

await step('focusing a field does not scroll the page', async () => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await page.evaluate(() => window.scrollTo(0, 0))
  const before = await page.evaluate(() => window.scrollY)
  await page.focus(addBox)
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => window.scrollY)
  if (after !== before) throw new Error(`page moved ${after - before}px on focus`)
})

await step('opening a suggestion list that fits does not scroll either', async () => {
  const before = await page.evaluate(() => window.scrollY)
  await page.fill(addBox, 'char')
  await page.waitForSelector('.suggest-list button')
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => window.scrollY)
  if (after !== before) throw new Error(`page moved ${after - before}px opening the list`)
  await page.keyboard.press('Escape')
  await page.fill(addBox, '')
})

await step('a list that would be cut off is scrolled into view', async () => {
  // A short viewport stands in for the space left by an on-screen keyboard.
  await page.setViewportSize({ width: 390, height: 420 })
  const field = page.locator('.card:has-text("Dragonite") input[placeholder^="Move"]').first()
  await page.locator('.card:has-text("Dragonite") .editor-head').first().click()
  await page.locator('.card:has-text("Dragonite") summary').first().click()
  await field.scrollIntoViewIfNeeded()
  await field.fill('Earth')
  await page.waitForSelector('.suggest-list button')
  await page.waitForTimeout(400)
  const fits = await page.evaluate(() => {
    const list = document.querySelector('.suggest-list')
    const vv = window.visualViewport
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
    return list.getBoundingClientRect().bottom <= bottom + 1
  })
  if (!fits) throw new Error('suggestion list is still below the visible area')
  await page.keyboard.press('Escape')
  await page.locator('.card:has-text("Dragonite") .editor-head').first().click()
  await page.setViewportSize({ width: 390, height: 844 })
})

await step('state survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Your Pokémon (8)', { timeout: 15000 })
  await page.waitForSelector('h2:has-text("team 6/6")', { timeout: 5000 })
})

await step('a Gen 3 game setup has its own Pokédex and Gen 3 rules', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await page.locator('summary:has-text("Game setup")').click()
  await page.click('button:text-is("New game")')
  await page.fill('input[placeholder="Pokémon Unbound"]', 'Vanilla Emerald')
  await page.locator('.sub-panel select').selectOption('3')
  await page.click('button:text-is("Create game")')
  await page.waitForSelector('text=Your Pokémon (0)', { timeout: 5000 })

  await page.fill(addBox, 'Lucario')
  if (await page.locator('.suggest-list button:text-is("Lucario")').count()) throw new Error('Lucario offered in Gen 3')
  await page.fill(addBox, '')
  for (const n of ['Clefairy', 'Gengar']) await add(n)
  const clefairy = await page.locator('.card:has-text("Clefairy") .editor-head').first().innerText()
  if (!clefairy.includes('Normal')) throw new Error(`Clefairy should be Normal in Gen 3: ${clefairy}`)

  await page.click('button[role="tab"]:has-text("Best Team")')
  const rows = await page.locator('.matrix tbody tr').count()
  if (rows !== 17) throw new Error(`expected 17 type rows without Fairy, got ${rows}`)
})

await step('switching back finds the first game untouched, and the choice survives a reload', async () => {
  const pick = page.locator('.setup-pick select')
  await pick.selectOption({ label: 'My game · Gen 9' })
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await page.waitForSelector('text=Your Pokémon (8)', { timeout: 5000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Your Pokémon (8)', { timeout: 15000 })
  await pick.selectOption({ label: 'Vanilla Emerald · Gen 3' })
  await page.waitForSelector('text=Your Pokémon (2)', { timeout: 5000 })
})

await step('no horizontal overflow at 390px', async () => {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (over > 0) throw new Error(`page scrolls ${over}px horizontally`)
})

await step('no console errors or failed requests', async () => {
  if (errors.length) throw new Error(errors.join(' ; '))
})

await browser.close()
console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSmoke test passed')
