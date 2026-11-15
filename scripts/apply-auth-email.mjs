// Applies the Auth email templates (supabase/templates) and the sign-up code settings to the hosted Supabase project
// "smart-agro". Reads the access token from .tmp/cloud/supabase.env and prints no secret and no template body.
//   node scripts/apply-auth-email.mjs                      dry run: GET only, lists what would change
//   node scripts/apply-auth-email.mjs --apply              saves the old values to .tmp/cloud/backups/, then applies and verifies
//   node scripts/apply-auth-email.mjs --restore <file>     puts the values from a backup file back
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const API = 'https://api.supabase.com/v1/projects/ihgqormeicusyqfphuub/config/auth'

/** The only settings this script owns. The templates keep the confirmation link, so an older app build still works. */
export function authEmailPayload(read) {
  return {
    mailer_templates_confirmation_content: read('supabase/templates/confirmation.html'),
    mailer_templates_recovery_content: read('supabase/templates/recovery.html'),
    mailer_subjects_confirmation: 'Kode verifikasi akun Smart Agro',
    mailer_subjects_recovery: 'Buat kata sandi baru untuk Smart Agro',
    mailer_otp_length: 6, // six digits, as the app's code field expects
    mailer_otp_exp: 600, // ten minutes, to keep the guessing window short
  }
}

const tidy = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value // Auth may reflow template whitespace
const token = () => {
  const line = readFileSync('.tmp/cloud/supabase.env', 'utf8').split(/\r?\n/).find(l => l.startsWith('SUPABASE_ACCESS_TOKEN='))
  if (!line) throw new Error('.tmp/cloud/supabase.env has no SUPABASE_ACCESS_TOKEN')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

async function main(args) {
  const headers = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }
  const get = async () => {
    const response = await fetch(API, { headers })
    if (!response.ok) throw new Error(`GET config/auth answered ${response.status}`)
    return response.json()
  }
  const patch = async body => {
    const response = await fetch(API, { method: 'PATCH', headers, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`PATCH config/auth answered ${response.status}`)
  }

  if (args[0] === '--restore') {
    const saved = JSON.parse(readFileSync(args[1], 'utf8'))
    await patch(saved)
    console.log('restored:', Object.keys(saved).join(', '))
    return
  }

  const payload = authEmailPayload(path => readFileSync(path, 'utf8'))
  const current = await get()
  const changes = Object.keys(payload).filter(key => tidy(current[key]) !== tidy(payload[key]))
  console.log(changes.length ? `would change: ${changes.join(', ')}` : 'cloud already matches the repo')
  if (!args.includes('--apply')) { console.log('dry run; add --apply to change the cloud'); return }

  mkdirSync('.tmp/cloud/backups', { recursive: true })
  const backup = `.tmp/cloud/backups/auth-email-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(backup, JSON.stringify(Object.fromEntries(Object.keys(payload).map(key => [key, current[key]])), null, 2))
  console.log('backup:', backup)
  await patch(payload)
  const after = await get()
  const wrong = Object.keys(payload).filter(key => tidy(after[key]) !== tidy(payload[key]))
  if (wrong.length) { console.log('MISMATCH after apply:', wrong.join(', '), `(restore with --restore ${backup})`); process.exit(1) }
  console.log('applied and verified:', Object.keys(payload).join(', '))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1) })
}
