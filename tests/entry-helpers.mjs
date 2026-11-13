// Shared steps since sign-in moved to the simulator gate (#masuk), profile to #profil, and online panels to the
// ecosystem tabs (2026-11-13).
const enterAsGuest = () => { try { localStorage.setItem('smart-agro.guest', '1') } catch { /* opaque origin */ } }

/** Checks that are not about accounts enter like a visitor who picked "Coba tanpa akun". */
export function asGuest(browser) {
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser)
  browser.newContext = async (...args) => { const context = await newContext(...args); await context.addInitScript(enterAsGuest); return context }
  browser.newPage = async (...args) => { const page = await newPage(...args); await page.addInitScript(enterAsGuest); return page }
  return browser
}

export const gate = page => page.getByRole('main', { name: 'Masuk ke Smart Agro', exact: true })

/** With Google enabled the email form starts folded; open it the way a visitor would. */
export async function emailForm(page) {
  const fold = gate(page).locator('details.signin-email')
  await fold.waitFor()
  if (!await fold.evaluate(d => d.open)) await fold.locator('summary').click()
}

export async function signIn(page, email, password, { signup = false } = {}) {
  await emailForm(page)
  await gate(page).getByLabel('Email', { exact: true }).fill(email)
  await gate(page).getByLabel('Kata sandi', { exact: true }).fill(password)
  await gate(page).getByRole('button', { name: signup ? 'Daftar' : 'Masuk', exact: true }).click()
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
