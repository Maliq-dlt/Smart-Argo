// Pots and gardens (Fase 4): the picker in the top bar, the wizard, replacing a plant, the garden's zones, no weather for a pot
// indoors, and everything surviving a reload. Guest mode, no backend. Serve the build with
// `npx vite preview --port 4174 --host 127.0.0.1` (default TEST_URL).
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const base = process.env.TEST_URL || 'http://127.0.0.1:4174/'
const output = '.tmp/garden'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
asGuest(browser)
const errors = []
let checks = 0
const ok = (value, message) => { assert(value, message); checks++ }
const KEY = 'smart-agro.garden.v1.guest'

const open = async ({ width = 1440, text = false, reducedMotion = 'no-preference' } = {}) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_FAILED|127\.0\.0\.1:54321/.test(message.text())) errors.push(message.text()) })
  await page.goto(new URL('#statistik', base).href); await curtainOpen(page)
  await page.locator('.plant-scene svg').waitFor()
  if (text) {
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
    await page.evaluate(() => { document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '' })
  }
  return page
}
const pill = page => page.locator('.session-pill .pill-trigger')
const potName = page => pill(page).locator('strong').textContent()
const openPicker = async page => { await pill(page).click(); await page.locator('.slot-picker').waitFor() }
const choose = async (page, name) => { await openPicker(page); await page.locator('.slot-picker').getByRole('button', { name }).click(); await page.locator('.slot-picker').waitFor({ state: 'detached' }) }
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY)
const sceneLabel = page => page.locator('.plant-scene svg').getAttribute('aria-label')
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

try {
  const page = await open()
  ok(await stored(page) === null, 'A visitor with no pots starts with no garden saved')

  // An empty picker explains itself and offers the two ways in.
  await openPicker(page)
  ok(/Belum ada pot atau kebun/.test(await page.locator('.slot-picker').innerText()), 'The empty picker says there is nothing yet')
  ok(await page.locator('.slot-picker').getByRole('button', { name: 'Ganti tanaman' }).count() === 0, 'A session outside any slot cannot be replaced')
  await page.locator('.slot-picker').getByRole('button', { name: 'Muat contoh kebun' }).click()
  await page.getByRole('status').filter({ hasText: 'Contoh dimuat' }).waitFor()

  // The demo: an orchid pot indoors, then a garden of two zones outdoors.
  ok(await potName(page) === 'Anggrek ruang tamu', `The first slot opens: ${await potName(page)}`)
  ok(/Anggrek bulan/.test(await sceneLabel(page) ?? ''), 'The stage draws the orchid')
  ok(await page.locator('.stage-weather').count() === 0, 'A pot indoors has no weather control')
  ok(await page.locator('.garden-summary').count() === 0, 'A pot has no zone summary')
  ok(await page.locator('.plant-scene svg').getAttribute('data-weather') === 'cerah' || (await page.locator('.plant-scene svg').getAttribute('data-weather')) === null, 'The sky indoors stays clear')
  await openPicker(page)
  const listed = await page.locator('.slot-picker').innerText()
  for (const text of ['Anggrek ruang tamu', 'Kebun belakang', 'Bedeng A', 'Bedeng B', 'Dalam ruangan', 'Luar ruangan']) ok(listed.includes(text), `The picker lists ${text}`)
  ok(await page.locator('.slot-picker [aria-current=true]').count() === 1, 'One slot is marked as the open one')
  await page.keyboard.press('Escape')

  await choose(page, /Bedeng A/)
  await page.locator('.garden-summary').waitFor()
  ok(await potName(page) === 'Bedeng A', 'Choosing a zone opens its session')
  ok(await page.locator('.garden-summary li').count() === 2, 'The summary lists both zones')
  ok(await page.locator('.garden-summary [aria-current=true]').innerText().then(t => t.includes('Bedeng A')), 'The open zone is marked')
  ok(await page.locator('.stage-weather').count() === 1, 'A garden outdoors has the weather control')
  await page.locator('.stage-weather').getByRole('radio', { name: 'Hujan', exact: true }).check()
  ok(/hujan/i.test(await page.locator('.stage-weather-note').innerText()), 'Rain shows its note outdoors')
  await page.locator('.garden-summary').getByRole('button', { name: /Bedeng B/ }).click()
  await page.waitForFunction(() => document.querySelector('.session-pill .pill-trigger strong')?.textContent === 'Bedeng B')
  ok(/Bawang merah/.test(await sceneLabel(page) ?? ''), 'The second zone draws the shallot')
  ok(await noOverflow(page), 'The garden summary does not widen the page')
  await page.screenshot({ path: `${output}/garden-1440.png`, fullPage: false })

  // The wizard: a personal pot, with the location only outdoors and the plant found by searching.
  await openPicker(page)
  await page.locator('.slot-picker').getByRole('button', { name: 'Tambah pot atau kebun' }).click()
  const wizard = page.getByRole('dialog', { name: 'Tambah pot atau kebun' })
  await wizard.waitFor()
  ok(await wizard.getByLabel('Lintang').count() === 0, 'No location asked for a pot indoors')
  await wizard.getByRole('radio', { name: 'Luar ruangan', exact: true }).check()
  ok(await wizard.getByLabel('Lintang').count() === 1 && await wizard.getByLabel('Bujur').count() === 1, 'A pot outdoors can say where it stands')
  await wizard.getByRole('radio', { name: 'Dalam ruangan', exact: true }).check()
  ok(await wizard.getByLabel('Lintang').count() === 0, 'The location goes away again indoors')
  await wizard.getByLabel('Nama', { exact: true }).fill('Pot dapur')
  await wizard.getByRole('searchbox').fill('xyz')
  ok(/Tidak ada tanaman yang cocok/.test(await wizard.innerText()), 'A search with no match says so')
  await wizard.getByRole('searchbox').fill('cabe')
  ok(await wizard.getByRole('radio', { name: /^Cabai/ }).count() === 1 && await wizard.getByRole('radio', { name: /^Bawang/ }).count() === 0, 'Searching "cabe" finds the chili by its alias')
  await wizard.getByRole('radio', { name: /^Cabai/ }).check()
  await wizard.getByRole('radio', { name: 'Kebun', exact: true }).check()
  ok(await wizard.getByLabel('Nama zona').count() === 2, 'A garden asks for zones')
  await wizard.getByRole('button', { name: 'Tambah zona' }).click()
  ok(await wizard.getByLabel('Nama zona').count() === 3, 'A zone can be added')
  await wizard.getByRole('radio', { name: 'Pot pribadi', exact: true }).check()
  await wizard.screenshot({ path: `${output}/wizard.png` })
  await wizard.getByRole('button', { name: 'Buat pot' }).click()
  await wizard.waitFor({ state: 'detached' })
  ok(await potName(page) === 'Pot dapur', 'The new pot opens')
  ok(/Cabai/.test(await sceneLabel(page) ?? ''), 'It grows the chili that was found')
  const afterAdd = await stored(page)
  ok(afterAdd.sites.length === 3 && afterAdd.slots.length === 4, `Saved on this device: ${afterAdd.sites.length} sites, ${afterAdd.slots.length} slots`)
  ok(afterAdd.slots.at(-1).cycles[0].nickname === 'Cabai 2', `A plant with no name is called by species and number: ${afterAdd.slots.at(-1).cycles[0].nickname}`)

  // Replacing a plant says what happens to the old cycle before it does it.
  await openPicker(page)
  await page.locator('.slot-picker').getByRole('button', { name: 'Ganti tanaman' }).click()
  const swap = page.getByRole('dialog', { name: /Ganti tanaman di Pot dapur/ })
  await swap.waitFor()
  const said = await swap.innerText()
  ok(/ditutup hari ini/.test(said) && /tidak diubah/.test(said) && /hari 0/.test(said), `The dialog explains the old cycle closes and its history is kept: ${said.slice(0, 160)}`)
  await swap.getByRole('button', { name: 'Ganti tanaman' }).click()
  ok(await swap.getByRole('alert').count() === 1, 'A replacement must be chosen first')
  await swap.getByRole('radio', { name: 'Berhasil', exact: true }).check()
  await swap.getByRole('searchbox').fill('bawang')
  await swap.getByRole('radio', { name: /^Bawang merah/ }).check()
  await swap.getByRole('button', { name: 'Ganti tanaman' }).click()
  await swap.waitFor({ state: 'detached' })
  await page.getByRole('status').filter({ hasText: 'ditutup dan riwayatnya disimpan' }).waitFor()
  ok(/Bawang merah/.test(await sceneLabel(page) ?? ''), 'The slot now grows the shallot')
  const afterSwitch = await stored(page)
  const potSlot = afterSwitch.slots.find(s => s.name === 'Pot dapur')
  ok(potSlot.cycles.length === 2, 'Two cycles in the slot')
  ok(potSlot.cycles[0].outcome === 'berhasil' && potSlot.cycles[0].endedOn === potSlot.cycles[1].plantedOn, 'The old cycle is closed as berhasil on the day the new one began')
  ok(potSlot.cycles[1].endedOn === undefined && potSlot.cycles[1].speciesId === 2, 'The new cycle is the only active one')
  ok(potSlot.cycles[0].plantedOn === afterAdd.slots.at(-1).cycles[0].plantedOn && potSlot.cycles[0].nickname === 'Cabai 2', 'The old cycle kept its own dates and name')

  // A reload keeps the garden, the open pot and the old history.
  await page.reload(); await curtainOpen(page); await page.locator('.plant-scene svg').waitFor()
  await openPicker(page)
  const reloaded = await page.locator('.slot-picker').innerText()
  for (const text of ['Anggrek ruang tamu', 'Bedeng A', 'Bedeng B', 'Pot dapur']) ok(reloaded.includes(text), `After a reload the picker still lists ${text}`)
  ok(deepEqualJson(await stored(page), afterSwitch), 'The stored garden did not change by reloading')
  await page.keyboard.press('Escape')
  ok(await noOverflow(page), 'No horizontal overflow after a reload')
  await page.close()

  // Another visitor scope never sees these pots, and a damaged save is set aside rather than shown or erased.
  const other = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await other.addInitScript(key => { if (!localStorage.getItem(key)) localStorage.setItem(key, '{broken') }, KEY)
  other.on('pageerror', error => errors.push(error.message))
  await other.goto(new URL('#statistik', base).href); await curtainOpen(other)
  await other.locator('.plant-scene svg').waitFor()
  await openPicker(other)
  ok(/Belum ada pot atau kebun/.test(await other.locator('.slot-picker').innerText()), 'A damaged garden opens as an empty one')
  ok(await other.evaluate(key => localStorage.getItem(`${key}.damaged`), KEY) === '{broken', 'The damaged text is kept aside')
  await other.close()

  // Phone: the picker, the wizard and the summary fit at 390 and 320 with text at 200%.
  for (const [width, text] of [[390, false], [320, true]]) {
    const phone = await open({ width, text, reducedMotion: 'reduce' })
    await openPicker(phone)
    await phone.locator('.slot-picker').getByRole('button', { name: 'Muat contoh kebun' }).click()
    await phone.getByRole('status').filter({ hasText: 'Contoh dimuat' }).waitFor()
    ok(await noOverflow(phone), `The demo does not widen the page at ${width}px`)
    await choose(phone, /Bedeng A/)
    await phone.locator('.garden-summary').waitFor()
    ok(await noOverflow(phone), `The garden summary fits at ${width}px${text ? ' with text at 200%' : ''}`)
    await phone.locator('.dash-stage').screenshot({ path: `${output}/garden-${width}${text ? '-text200' : ''}.png` })
    await openPicker(phone)
    const box = await phone.locator('.slot-picker').boundingBox()
    ok(box && box.x >= -1 && box.x + box.width <= width + 1, `The picker stays inside the screen at ${width}px`)
    await phone.locator('.slot-picker').getByRole('button', { name: 'Tambah pot atau kebun' }).click()
    const dialog = phone.getByRole('dialog', { name: 'Tambah pot atau kebun' })
    await dialog.waitFor()
    ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `The wizard does not scroll sideways at ${width}px`)
    await dialog.getByRole('radio', { name: 'Kebun', exact: true }).check()
    ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `The garden wizard does not scroll sideways at ${width}px`)
    await phone.close()
  }

  assert.deepEqual(errors, [], `Console errors: ${errors.join(' | ')}`)
  console.log(`garden-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}

function deepEqualJson(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
