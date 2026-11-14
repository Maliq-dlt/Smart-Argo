import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Native Node backup CLI is an ES module without TypeScript declarations.
import { validateTarget, backup, verify, restore } from '../scripts/database-backup.mjs'

test('backup tooling rejects unsafe restore targets and paths before database access', async () => {
  for (const target of [undefined, '', 'postgres', 'template0', 'template1', 'auth', 'public', 'extensions', 'supabase_auth_admin', 'has-dash', 'newdb\n', 'newdb\r\n', 'bad;DROP DATABASE postgres'])
    assert.throws(() => validateTarget(target, 'source'))
  assert.throws(() => validateTarget('source', 'source'))
  assert.equal(validateTarget('restore_drill_20261114', 'postgres'), 'restore_drill_20261114')
  await assert.rejects(backup('../outside.dump'), /inside/)
  await assert.rejects(backup('.tmp/backups/no.dump', 'bad;container'), /Invalid/)
  await assert.rejects(verify('.tmp/backups/no.dump', 'bad;container'), /Invalid/)
  await assert.rejects(backup('.tmp/backups/no.dump', 'valid_container\n'), /Invalid/)
  await assert.rejects(backup('.tmp/backups/no.dump', 'valid_container', 'newdb\n'), /Invalid/)
  await assert.rejects(restore('.tmp/backups/no.dump', 'postgres'), /new, non-system/)
})
