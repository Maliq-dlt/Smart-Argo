import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, realpath, link, unlink, writeFile, lstat } from 'node:fs/promises'
import { resolve, dirname, relative, isAbsolute, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)))
const directory = resolve(root, '.tmp/backups')
const identifier = /^[a-z][a-z0-9_]{0,62}(?![\s\S])/
export function validateTarget(target, source) {
  if (!identifier.test(target ?? '') || /^(postgres|template\d*|auth|public|extensions|supabase.*)$/.test(target) || target === source)
    throw new Error('Restore requires a new, non-system database name different from the source.')
  return target
}
function validateSource(container, database) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}(?![\s\S])/.test(container) || !identifier.test(database)) throw new Error('Invalid container or source database.')
}
function inside(path, base) {
  const rel = relative(base, path)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Backup path must stay inside the repository backup directory.')
}
async function archivePath(input, existing = false) {
  // ponytail: local ignored backups only; use managed encrypted storage/PITR for hosted deployments.
  await mkdir(resolve(root, '.tmp'), { recursive: true, mode: 0o700 })
  inside(await realpath(resolve(root, '.tmp')), root)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  inside(await realpath(directory), root)
  const path = resolve(root, input)
  inside(path, directory)
  inside(await realpath(dirname(path)), await realpath(directory))
  if (existing) {
    if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error('Archive must be a regular file.')
    inside(await realpath(path), await realpath(directory))
  }
  return path
}
async function run(container, args, { input, output } = {}) {
  const child = spawn('docker', ['exec', ...(input ? ['-i'] : []), container, ...args], { stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'] })
  // Database diagnostics can contain private values; retain only the exit code in public errors.
  child.stderr.resume()
  const done = new Promise((ok, fail) => {
    child.once('error', () => fail(new Error('Cannot launch Docker.')))
    child.once('close', code => code === 0 ? ok() : fail(new Error(`Database command failed (${args[0]}, exit ${code}).`)))
  })
  try { await Promise.all([done, input ? pipeline(input, child.stdin) : null, output ? pipeline(child.stdout, output) : null]) }
  catch (error) { child.kill(); throw error }
}
async function digest(path) {
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length }
  return { sha256: hash.digest('hex'), bytes }
}
async function absent(path) {
  try { await lstat(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  throw new Error('Backup output already exists; refusing overwrite.')
}
export async function verify(input, container = 'smart-agro-phase1-db-1') {
  validateSource(container, 'postgres')
  const path = await archivePath(input, true)
  const manifestPath = path + '.json'
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) throw new Error('Manifest must be a regular file.')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.format !== 'smart-agro.pg-backup.v1' || manifest.archive !== basename(path) || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || (typeof manifest.database !== 'string' || !identifier.test(manifest.database))) throw new Error('Invalid backup manifest.')
  const actual = await digest(path)
  if (actual.sha256 !== manifest.sha256 || actual.bytes !== manifest.bytes) throw new Error('Backup checksum or size mismatch.')
  await run(container, ['pg_restore', '--file=/dev/null'], { input: createReadStream(path) })
  return { path, manifest }
}
export async function backup(input, container = 'smart-agro-phase1-db-1', database = 'postgres') {
  validateSource(container, database)
  const path = await archivePath(input)
  await absent(path); await absent(path + '.json')
  const partial = path + '.' + randomUUID() + '.partial'
  const manifestPartial = partial + '.json'
  try {
    await run(container, ['pg_dump', '-U', 'postgres', '-d', database, '--format=custom'], { output: createWriteStream(partial, { flags: 'wx', mode: 0o600 }) })
    await run(container, ['pg_restore', '--file=/dev/null'], { input: createReadStream(partial) })
    const manifest = { format: 'smart-agro.pg-backup.v1', archive: basename(path), database, created_at: new Date().toISOString(), ...await digest(partial) }
    await writeFile(manifestPartial, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await link(partial, path)
    try { await link(manifestPartial, path + '.json') }
    catch (error) { await unlink(path); throw error }
    return { path, manifest }
  } finally {
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error })
    await unlink(manifestPartial).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
export async function restore(input, target, container = 'smart-agro-phase1-db-1') {
  validateTarget(target, 'postgres')
  const { path, manifest } = await verify(input, container)
  validateTarget(target, manifest.database)
  // createdb fails if the target exists; never use DROP, --clean, or an existing database.
  await run(container, ['createdb', '-U', 'postgres', '--template=template0', target])
  await run(container, ['pg_restore', '-U', 'postgres', '-d', target, '--single-transaction', '--exit-on-error'], { input: createReadStream(path) })
  return { target, source: manifest.database }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { container: { type: 'string', default: 'smart-agro-phase1-db-1' }, database: { type: 'string', default: 'postgres' }, target: { type: 'string' } } })
    const [command, input] = positionals
    if (positionals.length > 2 || !['backup','verify','restore'].includes(command) || (command !== 'backup' && !input)) throw new Error('Usage: node scripts/database-backup.mjs backup|verify|restore [archive] [--container name] [--database source] [--target new_database]')
    const path = input ?? `.tmp/backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}.dump`
    const result = command === 'backup' ? await backup(path, values.container, values.database) : command === 'verify' ? await verify(path, values.container) : await restore(path, values.target, values.container)
    console.log(JSON.stringify(command === 'restore' ? result : { archive: relative(root, result.path), bytes: result.manifest.bytes, sha256: result.manifest.sha256 }))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
