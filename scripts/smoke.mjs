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

/** The custom-add field under the checklist; it also adds dex Pokémon by name. */
const addBox = 'input[placeholder*="Search by name"]'
const add = async (name) => {
  await page.fill(addBox, name)
  await page.locator(`.suggest-list button:text-is("${name}")`).click({ timeout: 10000 })
  // Adding opens the new Pokémon; close it to get back to the list.
  await page.waitForSelector('dialog.pokemon-modal[open]', { timeout: 5000 })
  await page.keyboard.press('Escape')
}
const box = (name) => page.locator(`input[type="checkbox"][aria-label="${name} caught"]`)
// Dispatched straight to the box: a real tap scrolled to the top would land on the sticky header.
const tick = (name) => box(name).dispatchEvent('click')
const caught = async () => Number((await page.locator('span.lcd[aria-label*=" caught"]').first().innerText()).split('/')[0])
const waitCaught = (n) =>
  page.waitForFunction(
    (n) => document.querySelector('span.lcd[aria-label*=" caught"]')?.textContent?.startsWith(`${n}/`),
    n,
    { timeout: 5000 },
  )
const openMon = async (name) => {
  await page.locator(`.dex-open[aria-label="Open ${name}"]`).first().dispatchEvent('click')
  await page.waitForSelector('dialog.pokemon-modal[open]', { timeout: 5000 })
}
const modal = 'dialog.pokemon-modal[open]'

console.log(`Testing ${url}\n`)
await page.goto(url, { waitUntil: 'networkidle' })

await step('app renders', () => page.waitForSelector('h1:has-text("Hack Team Builder")', { timeout: 15000 }))

await step('the Pokédex is a checklist of the whole dex', async () => {
  await page.waitForSelector('.dex-row', { timeout: 10000 })
  const rows = await page.locator('.dex-row').count()
  if (rows < 1000) throw new Error(`expected the National Dex, got ${rows} rows`)
  if ((await caught()) !== 0) throw new Error('fresh game should have nothing caught')
})

await step('ticking catches it and fills the team', async () => {
  await tick('Charizard')
  await waitCaught(1)
  if (!(await box('Charizard').isChecked())) throw new Error('Charizard not ticked')
  if (!(await page.locator('.dex-row:has(input[aria-label="Charizard caught"]) .pill').count())) throw new Error('no Team mark')
})

await step('ticks eight Pokemon', async () => {
  for (const n of ['Blastoise', 'Venusaur', 'Gengar', 'Machamp', 'Lapras', 'Snorlax', 'Dragonite']) await tick(n)
  await waitCaught(8)
})

await step('the filter and Caught view narrow the list', async () => {
  await page.fill('input[type="search"]', 'saur')
  const names = await page.locator('.dex-row .dex-open .truncate').allInnerTexts()
  if (!names.every((n) => n.toLowerCase().includes('saur'))) throw new Error(`filter let through: ${names.join(', ')}`)
  await page.fill('input[type="search"]', '')
  await page.click('button[aria-pressed]:text-is("Caught")')
  const rows = await page.locator('.dex-row').count()
  if (rows !== 8) throw new Error(`Caught view shows ${rows}`)
  await page.click('button[aria-pressed]:text-is("All")')
})

await step('evolving moves the tick to the evolution', async () => {
  await tick('Eevee')
  await waitCaught(9)
  await openMon('Eevee')
  await page.locator(`${modal} button:has-text("Evolve → Vaporeon")`).click()
  await page.waitForSelector(`${modal} h2:text-is("Vaporeon")`, { timeout: 5000 })
  await page.keyboard.press('Escape')
  if (await box('Eevee').isChecked()) throw new Error('Eevee still ticked')
  if (!(await box('Vaporeon').isChecked())) throw new Error('Vaporeon not ticked')
})

await step('unticking an edited Pokémon needs a second untick', async () => {
  await openMon('Vaporeon')
  await page.locator(`${modal} label:has-text("Level") input`).fill('33')
  await page.keyboard.press('Escape')
  await tick('Vaporeon')
  await page.waitForSelector('.dex-pending:has-text("Vaporeon has edits")', { timeout: 5000 })
  if (!(await box('Vaporeon').isChecked())) throw new Error('first untick removed it')
  await tick('Vaporeon')
  await waitCaught(8)
})

await step('the modal removes with two taps and closes with Escape', async () => {
  await tick('Pikachu')
  await waitCaught(9)
  await openMon('Pikachu')
  await page.locator(`${modal} button:has-text("Remove Pikachu")`).click()
  await page.locator(`${modal} button:has-text("Cancel")`).click()
  await page.locator(`${modal} button:has-text("Remove Pikachu")`).click()
  await page.locator(`${modal} button:has-text("Yes, remove")`).click()
  await page.waitForSelector(modal, { state: 'detached', timeout: 5000 }).catch(() => {})
  if (await page.locator(modal).count()) throw new Error('modal still open after removing')
  await waitCaught(8)
})

await step('auto-build fills exactly six', async () => {
  await page.click('button[role="tab"]:has-text("Best Team")')
  await page.click('button:has-text("Auto-build")')
  await page.waitForSelector('h2:has-text("Team (6/6)")', { timeout: 5000 })
})

await step('defensive matrix covers all 18 types x 6 members', async () => {
  const rows = await page.locator('.matrix tbody tr').count()
  if (rows !== 18) throw new Error(`expected 18 rows, got ${rows}`)
  const cells = await page.locator('.matrix tbody tr').first().locator('td:not(.team-col)').count()
  if (cells !== 6) throw new Error(`expected 6 cells per row, got ${cells}`)
  if (!(await page.locator('.matrix tbody tr').first().locator('td.team-col').count())) throw new Error('no Team column')
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
    const tds = [...document.querySelectorAll('.matrix tbody td:not(.team-col)')]
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

await step('the Hits view shows what each member hits, in the same grid', async () => {
  await page.click('button[aria-pressed]:text-is("Hits")')
  const blue = await page.locator('.matrix tbody td.qtr').count()
  if (blue === 0) throw new Error('no super-effective hits shown')
  await page.locator('.matrix tbody td.qtr').first().click()
  const text = await page.locator('.matrix-readout').innerText()
  if (!/hits .* for double damage/.test(text)) throw new Error(`unexpected readout: ${text}`)
  const m = await page.evaluate(() => {
    const table = document.querySelector('.matrix')
    return table.scrollWidth - table.closest('.card').clientWidth
  })
  if (m > 0) throw new Error(`Hits grid overflows by ${m}px`)
  console.log(`        "${text}"`)
  await page.click('button[aria-pressed]:text-is("Takes")')
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

await step('editing a move in the modal updates the member', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await openMon('Charizard')
  await page.locator(`${modal} summary:has-text("Hack changes")`).click()
  const field = page.locator(`${modal} input[placeholder^="Move"]`).first()
  await field.fill('Earthquake')
  await page.locator('.suggest-list button:text-is("Earthquake")').click()
  if ((await field.inputValue()) !== 'Earthquake') throw new Error('move not applied')
  await page.keyboard.press('Escape')
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

// The Opponent search sits near the top; the checklist's add field is a thousand rows down.
const topBox = 'input[placeholder*="Search the dex"]'

await step('focusing a field does not scroll the page', async () => {
  await page.click('button[role="tab"]:has-text("Opponent")')
  await page.evaluate(() => window.scrollTo(0, 0))
  const before = await page.evaluate(() => window.scrollY)
  await page.focus(topBox)
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => window.scrollY)
  if (after !== before) throw new Error(`page moved ${after - before}px on focus`)
})

await step('opening a suggestion list that fits does not scroll either', async () => {
  const before = await page.evaluate(() => window.scrollY)
  await page.fill(topBox, 'char')
  await page.waitForSelector('.suggest-list button')
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => window.scrollY)
  if (after !== before) throw new Error(`page moved ${after - before}px opening the list`)
  await page.keyboard.press('Escape')
  await page.click('button[role="tab"]:has-text("Pokédex")')
})

await step('a list that would be cut off stays visible inside the modal', async () => {
  // A short viewport stands in for the space left by an on-screen keyboard.
  await page.setViewportSize({ width: 390, height: 420 })
  await openMon('Dragonite')
  await page.locator(`${modal} summary:has-text("Hack changes")`).click()
  const field = page.locator(`${modal} input[placeholder^="Move"]`).first()
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
  if (!fits) throw new Error('suggestion list is below the visible area')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
})

await step('state survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.dex-row', { timeout: 15000 })
  await waitCaught(8)
  const team = await page.locator('.party-slot:not(.empty)').count()
  if (team !== 6) throw new Error(`expected 6 in the party, got ${team}`)
})

await step('a Gen 3 game setup has its own Pokédex and Gen 3 rules', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await page.locator('summary:has-text("Game setup")').click()
  await page.click('button:text-is("New game")')
  await page.fill('input[placeholder="Pokémon Unbound"]', 'Vanilla Emerald')
  await page.locator('.sub-panel label:has-text("up to") select').selectOption('3')
  await page.click('button:text-is("Create game")')
  await waitCaught(0)
  if (await box('Lucario').count()) throw new Error('Lucario listed in a Gen 3 dex')

  await page.fill(addBox, 'Lucario')
  if (await page.locator('.suggest-list button:text-is("Lucario")').count()) throw new Error('Lucario offered in Gen 3')
  await page.fill(addBox, '')
  for (const n of ['Clefairy', 'Gengar']) await tick(n)
  await waitCaught(2)
  const clefairy = await page.locator('.dex-row:has(input[aria-label="Clefairy caught"]) .types').innerText()
  if (!clefairy.includes('Normal')) throw new Error(`Clefairy should be Normal in Gen 3: ${clefairy}`)

  await page.click('button[role="tab"]:has-text("Best Team")')
  const rows = await page.locator('.matrix tbody tr').count()
  if (rows !== 17) throw new Error(`expected 17 type rows without Fairy, got ${rows}`)
})

await step('switching back finds the first game untouched, and the choice survives a reload', async () => {
  const pick = page.locator('.setup-pick select')
  await pick.selectOption({ label: 'My game · Gen 9' })
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await waitCaught(8)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.dex-row', { timeout: 15000 })
  await waitCaught(8)
  await pick.selectOption({ label: 'Vanilla Emerald · Gen 3' })
  await waitCaught(2)
})

await step('an Unbound game offers boss teams and rates damage by level', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  const setup = page.locator('summary:has-text("Game setup")')
  if (!(await page.locator('button:text-is("New game")').isVisible())) await setup.click()
  await page.click('button:text-is("New game")')
  await page.locator('.sub-panel label:has-text("Hack data") select').selectOption('unbound')
  const gen = await page.locator('.sub-panel label:has-text("up to") select').inputValue()
  if (gen !== '8') throw new Error(`Unbound should suggest Gen 8, got ${gen}`)
  await page.click('button:text-is("Create game")')
  await page.waitForSelector('button[aria-pressed]:text-is("Regional")', { timeout: 10000 })
  const first = await page.locator('.dex-row .dex-open .truncate').first().innerText()
  if (first !== 'Snorunt') throw new Error(`Unbound's regional dex starts with Snorunt, got ${first}`)
  const difficulties = await page.locator('label:has-text("Trainer difficulty") option').allTextContents()
  if (difficulties.join(',') !== 'Vanilla,Difficult,Expert,Insane') throw new Error(`difficulties: ${difficulties}`)
  const difficulty = page.locator('label:has-text("Trainer difficulty") select')
  if (!(await difficulty.isVisible())) await page.locator('summary:has-text("Game setup")').click()
  await difficulty.selectOption('vanilla')
  if (!(await page.locator('text=Uses the Difficult teams').count())) throw new Error('Vanilla note missing')
  await tick('Pikachu').catch(async () => {
    await page.click('button[aria-pressed]:text-is("National")')
    await tick('Pikachu')
  })
  await waitCaught(1).catch(() => {})
  await openMon('Pikachu')
  await page.locator(`${modal} label:has-text("Level") input`).fill('20')
  await page.keyboard.press('Escape')

  await page.click('button[role="tab"]:has-text("Opponent")')
  await page.fill('input[placeholder*="Leader, rival"]', 'Champion Jax')
  await page.locator('.suggest-list button:text-is("Champion Jax")').click()
  await page.locator('[role="group"][aria-label*="Champion Jax"] button').first().click()
  await page.waitForSelector('h2:has-text("Full order")', { timeout: 5000 })
  const order = await page.locator('.card:has(h2:has-text("Full order"))').innerText()
  if (!order.includes('KO')) throw new Error(`a level 20 Pikachu should be one-shot by the Champion: ${order.slice(0, 160)}`)
  const best = await page.locator('.card:has(h2:has-text("Best:"))').innerText()
  if (!/Takes \d/.test(best)) throw new Error(`no damage numbers: ${best.slice(0, 160)}`)
  console.log('        ' + best.replace(/\n+/g, ' | ').slice(0, 220))
})

await step('the Dex header and party stay put while the screen scrolls', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  await page.locator('.setup-pick select').selectOption({ label: 'My game · Gen 9' })
  await waitCaught(8)
  await page.evaluate(() => window.scrollTo(0, 600))
  await page.waitForTimeout(200)
  const pos = await page.evaluate(() => ({
    scrolled: window.scrollY,
    head: document.querySelector('.shell-top').getBoundingClientRect(),
    party: document.querySelector('.party').getBoundingClientRect().top,
  }))
  if (pos.scrolled < 300) throw new Error(`page did not scroll (${pos.scrolled})`)
  if (Math.abs(pos.head.top) > 1) throw new Error(`header moved to ${pos.head.top}`)
  // Nothing hides under the pinned header: the first thing below it starts at its bottom edge.
  const gap = await page.evaluate(() => {
    window.scrollTo(0, 0)
    return document.querySelector('.bezel').getBoundingClientRect().top - document.querySelector('.shell-top').getBoundingClientRect().bottom
  })
  if (Math.abs(gap) > 1) throw new Error(`content starts ${gap}px from the header's bottom`)
  await page.evaluate(() => window.scrollTo(0, 600))
  await page.waitForTimeout(100)
  if (Math.abs(pos.party - pos.head.bottom) > 1) throw new Error(`party at ${pos.party}, header ends at ${pos.head.bottom}`)
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/smoke-sticky.png' })
  await page.evaluate(() => window.scrollTo(0, 0))
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
