// Shared steps since sign-in moved to the simulator gate (#masuk), profile to #profil, and online panels to the
// ecosystem tabs (2026-11-13).
import { totp } from './totp.mjs'
const enterAsGuest = () => { try { localStorage.setItem('smart-agro.guest', '1') } catch { /* opaque origin */ } }

/** Checks that are not about accounts enter like a visitor who picked "Coba tanpa akun". */
export function asGuest(browser) {
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser)
  browser.newContext = async (...args) => { const context = await newContext(...args); await context.addInitScript(enterAsGuest); return context }
  browser.newPage = async (...args) => { const page = await newPage(...args); await page.addInitScript(enterAsGuest); return page }
  return browser
}

export const gate = page => page.getByRole('main', { name: 'Masuk ke Smart Agro', exact: true })

/** The email form is always open (since 2026-11-14); "Masuk" and "Daftar" are tabs above it. */
export async function emailForm(page, { signup = false } = {}) {
  const tab = gate(page).getByRole('tab', { name: signup ? 'Daftar' : 'Masuk', exact: true })
  await tab.waitFor()
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click()
}

const potSetup = page => page.getByRole('main', { name: 'Siapkan pot', exact: true })
/** A first sign-in opens "Siapkan pot": keep its defaults and continue, as a visitor in a hurry would. Returns at
 * once when the sign-in ends elsewhere instead (the app, the authenticator step, or an error). */
export async function passPotSetup(page) {
  const setup = potSetup(page), app = page.locator('.app-shell')
  await setup.or(app).or(gate(page).getByLabel('Kode autentikator', { exact: true })).or(page.locator('.entry-notice[role=alert]')).first().waitFor({ timeout: 30000 })
  if (!await setup.isVisible()) return
  await setup.getByRole('button', { name: 'Simpan dan mulai', exact: true }).click()
  await app.waitFor({ timeout: 30000 })
}

/** `secret` answers the authenticator step: operator and curator tools only open in an AAL2 session (2026-11-14). */
export async function signIn(page, email, password, { signup = false, secret } = {}) {
  await emailForm(page, { signup })
  await gate(page).getByLabel('Email', { exact: true }).fill(email)
  await gate(page).getByLabel('Kata sandi', { exact: true }).fill(password)
  await gate(page).getByRole('button', { name: signup ? 'Buat akun' : 'Masuk', exact: true }).click()
  await passPotSetup(page)
  if (!secret) return
  await gate(page).getByLabel('Kode autentikator', { exact: true }).fill(totp(secret))
  await gate(page).getByRole('button', { name: 'Verifikasi', exact: true }).click()
  // The code field lingers for a moment after the click; passPotSetup would take it for "still on this step".
  await gate(page).getByLabel('Kode autentikator', { exact: true }).waitFor({ state: 'detached', timeout: 30000 })
  await passPotSetup(page)
}

export async function signOut(page) {
  await page.getByRole('button', { name: /^Akun: / }).click()
  await page.getByRole('dialog', { name: 'Menu akun' }).getByRole('button', { name: 'Keluar', exact: true }).click()
  await gate(page).waitFor()
}

const go = async (page, hash) => { if (new URL(page.url()).hash !== hash) await page.evaluate(h => { location.hash = h }, hash) }

export async function ecosystemTab(page, label) {
  await go(page, '#ekosistem')
  await page.getByRole('navigation', { name: 'Modul ekosistem Miro' }).getByRole('button', { name: label, exact: true }).click()
}

export async function profileSection(page, label) {
  await go(page, '#profil')
  await page.getByRole('navigation', { name: 'Bagian profil' }).getByRole('button', { name: label, exact: true }).click()
}
