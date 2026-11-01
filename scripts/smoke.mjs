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
// A context, not browser.newPage, so a second tab can share its storage.
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

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
  await page.locator(`${modal} label:has-text("Nature") select`).selectOption({ index: 0 })
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
  await page.click('button[role="tab"]:has-text("Opponent")')
  // Clear and retype like a person: an emptied box must not snap to 1 (which made "45" into "145").
  const teamLevel = page.locator('label:has-text("Your team\'s level") input')
  await teamLevel.fill('')
  // Wait past the sync status flip: a re-render must not write the old level back into the emptied box.
  await page.waitForTimeout(1500)
  if ((await teamLevel.inputValue()) !== '') throw new Error(`emptied box refilled with ${await teamLevel.inputValue()}`)
  await teamLevel.pressSequentially('45')
  await page.waitForTimeout(1500)
  if ((await teamLevel.inputValue()) !== '45') throw new Error(`retyped level reads ${await teamLevel.inputValue()}`)
  await teamLevel.fill('150')
  await teamLevel.blur()
  if ((await teamLevel.inputValue()) !== '100') throw new Error(`150 should snap to 100 on leaving, got ${await teamLevel.inputValue()}`)
  await teamLevel.fill('20')
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

await step('sync waits while a box has focus and runs on leaving it', async () => {
  const isPut = (r) => r.method() === 'PUT' && r.url().includes('/api/setups/')
  let puts = 0
  const count = (r) => { if (isPut(r)) puts++ }
  page.on('request', count)
  const teamLevel = page.locator('label:has-text("Your team\'s level") input')
  await teamLevel.fill('33')
  await page.waitForTimeout(1500)
  page.off('request', count)
  if (puts) throw new Error(`${puts} saves sent while the box still had focus`)
  const sent = page.waitForRequest(isPut, { timeout: 3000 })
  await teamLevel.blur()
  await sent
})

await step('an Emerald Rogue game tracks the overworld, Day Care and a six-Pokémon party', async () => {
  await page.click('button[role="tab"]:has-text("Pokédex")')
  if (!(await page.locator('button:text-is("New game")').isVisible())) await page.locator('summary:has-text("Game setup")').click()
  await page.click('button:text-is("New game")')
  await page.locator('.sub-panel label:has-text("Hack data") select').selectOption('rogue')
  await page.click('button:text-is("Create game")')
  await page.locator('label:has-text("Run Pokédex") select').selectOption('kanto_rby', { timeout: 10000 })
  if ((await page.locator('button[role="tab"]').allTextContents()).join(',') !== 'Pokédex,Party,Capture Next,Opponent') {
    throw new Error('Rogue tabs not renamed')
  }

  await page.fill('input[aria-label="Filter the Pokédex by name"]', 'Zubat')
  await page.locator('input[aria-label="Zubat in the overworld"]').dispatchEvent('click')
  await page.locator('button[aria-label="Zubat in the Day Care"]').click()
  await page.click('button:has-text("Day Care 1/3")')
  if ((await page.locator('.dex-row').count()) !== 1) throw new Error('Day Care filter should show only Zubat')

  const join = async (name) => {
    await page.fill('input[placeholder="Search any Pokémon"]', name)
    await page.locator(`.suggest-list button:text-is("${name}")`).click({ timeout: 5000 })
  }
  for (const n of ['Bulbasaur', 'Charmander', 'Squirtle', 'Pikachu', 'Eevee', 'Abra']) await join(n)
  await join('Mareep')
  // A modal over wherever the player is, not a card at the top of the page.
  const full = 'dialog[open][aria-labelledby="replace-title"]'
  await page.waitForSelector(full, { timeout: 5000 })
  await page.locator(`${full} button:has-text("Pikachu")`).click()
  const party = await page.locator('.party-slot:not(.empty)').evaluateAll((els) => els.map((e) => e.title))
  if (party.join(',') !== 'Bulbasaur,Charmander,Squirtle,Mareep,Eevee,Abra') throw new Error(`party: ${party}`)

  await page.click('button[role="tab"]:has-text("Party")')
  if (await page.locator('button:text-is("Auto-build")').count()) throw new Error('Auto-build shown in Rogue')
  await page.click('button[role="tab"]:has-text("Capture Next")')
  await page.waitForSelector('h2:text-is("Capture next")', { timeout: 5000 })
  if (!(await page.locator('.card p:has-text("Replaces")').count())) throw new Error('Capture next does not say who to replace')

  await page.click('button[role="tab"]:has-text("Opponent")')
  if (await page.locator('button:text-is("Everything I own")').count()) throw new Error('Everything I own shown in Rogue')
  await page.fill('input[placeholder*="Search the dex"]', 'Gengar')
  await page.locator('.suggest-list button:text-is("Gengar")').click()
  if (await page.locator('details:has(summary:has-text("Its moves")) ').evaluate((d) => d.open)) {
    throw new Error('unknown opponent moves should start collapsed')
  }
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

await step('only a vanilla game picks hack data, and not Rogue with more than six owned', async () => {
  // Still on "My game": vanilla, eight caught.
  const picker = page.locator('label:has(> span:text-is("Hack data")):not(.sub-panel *) select')
  const rogue = picker.locator('option[value="rogue"]')
  if (!(await rogue.evaluate((o) => o.disabled))) throw new Error(`Emerald Rogue offered for an eight-Pokémon game: ${await picker.evaluate((s) => s.outerHTML)}`)
  await page.locator('.setup-pick select').selectOption({ label: 'Pokémon Unbound · Gen 8' })
  await page.waitForSelector('button[aria-pressed]:text-is("Regional")', { timeout: 10000 })
  if (await picker.count()) throw new Error('a game that has hack data can still change it')
  await page.locator('.setup-pick select').selectOption({ label: 'My game · Gen 9' })
  await waitCaught(8)
})

await step('a game made in another tab survives an edit in this one', async () => {
  const other = await page.context().newPage()
  await other.goto(url, { waitUntil: 'networkidle' })
  await other.waitForSelector('.dex-row', { timeout: 10000 })
  if (!(await other.locator('button:text-is("New game")').isVisible())) await other.locator('summary:has-text("Game setup")').click()
  await other.click('button:text-is("New game")')
  await other.fill('input[placeholder="Pokémon Unbound"]', 'Other tab')
  await other.click('button:text-is("Create game")')
  await other.waitForTimeout(300)
  await other.close()
  // An edit here used to write this tab's older games list back over the other tab's.
  await tick('Pidgey')
  await page.reload({ waitUntil: 'networkidle' })
  const games = await page.locator('.setup-pick option').allTextContents()
  if (!games.some((g) => g.startsWith('Other tab'))) throw new Error(`games after the edit: ${games.join(', ')}`)
  await tick('Pidgey')
})

await step('deleting the open game in another tab reloads this one instead of saving over another game', async () => {
  const mine = await caught()
  const before = await page.locator('.setup-pick select option:checked').innerText()
  await page.locator('.setup-pick select').selectOption({ label: 'Other tab · Gen 9' })
  // A tick before the switched-to game has loaded would be wiped by the load.
  await waitCaught(0)
  await page.waitForTimeout(300)
  await tick('Bulbasaur')
  await waitCaught(1).catch(async () => { throw new Error(`after ticking: ${await caught()} caught`) })
  const other = await page.context().newPage()
  await other.goto(url, { waitUntil: 'networkidle' })
  await other.waitForSelector('.dex-row', { timeout: 10000 })
  if ((await other.locator('.setup-pick select option:checked').innerText()) !== 'Other tab · Gen 9') throw new Error('second tab did not open the same game')
  if (!(await other.locator('button:text-is("Delete game")').isVisible())) await other.locator('summary:has-text("Game setup")').click()
  await other.click('button:text-is("Delete game")')
  await other.click('button:text-is("Yes, delete Other tab")')
  await other.waitForTimeout(300)
  await other.close()
  // This tab must now show the game it fell back to, with that game's own Pokédex.
  await waitCaught(mine).catch(async () => {
    throw new Error(`was ${mine} caught in ${before}; after the delete ${await caught()} in ${await page.locator('.setup-pick select option:checked').innerText()}`)
  })
})

await step('no horizontal overflow at 390px', async () => {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (over > 0) throw new Error(`page scrolls ${over}px horizontally`)
})

await step('on a landscape tablet the tabs sit under the header and cards go two across', async () => {
  // Pixel Tablet landscape, in CSS pixels.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.click('button[role="tab"]:has-text("Team")')
  await page.waitForTimeout(200)
  const box = await page.evaluate(() => ({
    tabs: document.querySelector('.tabs').getBoundingClientRect(),
    head: document.querySelector('.shell-top').getBoundingClientRect(),
    columns: getComputedStyle(document.querySelector('.cards')).gridTemplateColumns.split(' ').length,
  }))
  if (box.tabs.bottom > box.head.bottom + 1) throw new Error(`tabs at ${box.tabs.top}, header ends ${box.head.bottom}`)
  if (box.columns !== 2) throw new Error(`${box.columns} card columns`)
  await page.screenshot({ path: process.env.SHOT_WIDE ?? '/tmp/smoke-wide.png' })
  await page.setViewportSize({ width: 390, height: 844 })
})

await step('the app fills the whole window on tablets and phones, either way round', async () => {
  // Pixel Tablet landscape and portrait, a landscape phone, a portrait phone.
  for (const [width, height] of [[1280, 800], [800, 1280], [844, 390], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => ({
      dex: document.querySelector('.dex').getBoundingClientRect(),
      head: document.querySelector('.shell-top').getBoundingClientRect(),
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    const at = `${width}x${height}`
    if (Math.abs(got.dex.width - width) > 1) throw new Error(`${at}: app is ${got.dex.width}px wide`)
    if (Math.abs(got.head.width - width) > 1) throw new Error(`${at}: header is ${got.head.width}px wide`)
    if (got.dex.bottom < height - 1) throw new Error(`${at}: app ends at ${got.dex.bottom}px`)
    if (Math.abs(got.head.top) > 1) throw new Error(`${at}: header starts at ${got.head.top}px`)
    if (got.over > 0) throw new Error(`${at}: page scrolls ${got.over}px sideways`)
    if (width === 800) await page.screenshot({ path: process.env.SHOT_TALL ?? '/tmp/smoke-portrait.png' })
  }
})

await step('no console errors or failed requests', async () => {
  if (errors.length) throw new Error(errors.join(' ; '))
})

await browser.close()
console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSmoke test passed')
