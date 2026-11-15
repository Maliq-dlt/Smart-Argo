import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Native Node script (an ES module) without TypeScript declarations.
import { authEmailPayload } from '../scripts/apply-auth-email.mjs'

// What scripts/apply-auth-email.mjs sends to the hosted Auth settings: the two templates from the repo, their
// subjects, and a six-digit code that lasts ten minutes. Nothing else in the Auth config is touched.
test('the payload is exactly the six email settings, with templates read from supabase/templates', () => {
  const read: string[] = []
  const payload = authEmailPayload((path: string) => { read.push(path); return `<html>${path}</html>` })
  assert.deepEqual(Object.keys(payload).sort(), [
    'mailer_otp_exp', 'mailer_otp_length', 'mailer_subjects_confirmation', 'mailer_subjects_recovery',
    'mailer_templates_confirmation_content', 'mailer_templates_recovery_content',
  ])
  assert.deepEqual(read.sort(), ['supabase/templates/confirmation.html', 'supabase/templates/recovery.html'])
  assert.equal(payload.mailer_templates_confirmation_content, '<html>supabase/templates/confirmation.html</html>')
  assert.equal(payload.mailer_templates_recovery_content, '<html>supabase/templates/recovery.html</html>')
  assert.equal(payload.mailer_subjects_confirmation, 'Kode verifikasi akun Smart Agro')
  assert.equal(payload.mailer_subjects_recovery, 'Buat kata sandi baru untuk Smart Agro')
  assert.equal(payload.mailer_otp_length, 6)
  assert.equal(payload.mailer_otp_exp, 600)
})
