import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'

// Runs inside the assessment network; removes only its own newly created test account.
const base = 'http://app:54321'
const settings = JSON.parse(await readFile('/run/smart-agro/settings.json', 'utf8'))
const request = async (path, token = settings.anon, body, method = 'POST') => {
  const response = await fetch(base + path, {
    method, headers: { apikey: settings.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}
const ok = label => console.log(`PASS ${label}`)
assert.equal((await fetch(base + '/health')).status, 200)
const html = await (await fetch(base + '/')).text()
assert.match(html, /id="root"/)
const asset = html.match(/src="([^"]*\/assets\/[^" ]+\.js)"/)
assert.ok(asset, 'Built entry script is present')
assert.equal((await fetch(new URL(asset[1], base))).status, 200)
const runtime = await (await fetch(base + '/runtime-config.js')).text()
assert.ok(runtime.includes(settings.anon))
for (const secret of [settings.password, settings.secret, settings.service]) assert.equal(runtime.includes(secret), false, 'Server secrets must stay private')
assert.equal((await fetch(base + '/.env.local')).status, 404)
const traversal = await new Promise((resolve, reject) => {
  http.get(base + '/..%2f..%2frun/smart-agro/settings.json', response => { response.resume(); resolve(response.statusCode) }).on('error', reject)
})
assert.equal(traversal, 403)
assert.equal((await fetch(base + '/%ZZ')).status, 400)
ok('health, compiled assets, runtime config and static path boundaries')

const email = `docker-smoke-${randomUUID()}@example.test`
const password = randomBytes(24).toString('base64url')
let userId
try {
  const signup = await request('/auth/v1/signup', settings.anon, { email, password })
  assert.equal(signup.status, 200, 'Local Auth signup succeeds')
  userId = signup.data.user?.id
  assert.match(userId, /^[0-9a-f-]{36}$/)
  const login = await request('/auth/v1/token?grant_type=password', settings.anon, { email, password })
  assert.equal(login.status, 200, 'Password login succeeds')
  const token = login.data.access_token
  assert.equal(typeof token, 'string')
  const account = await request('/rest/v1/rpc/ensure_my_account', token, {})
  assert.equal(account.status, 200)
  assert.equal(account.data.ok, true)
  assert.deepEqual(account.data.account.access_roles, ['owner'])
  const retry = await request('/rest/v1/rpc/ensure_my_account', token, {})
  assert.equal(retry.data.account.id, account.data.account.id)
  const products = await request('/rest/v1/rpc/my_products', token, {})
  assert.equal(products.status, 200)
  assert.deepEqual(products.data.products, [])
  const denied = await request('/rest/v1/rpc/my_products', settings.anon, {})
  assert.ok([401, 403].includes(denied.status))
  const privateData = await request('/rest/v1/account?select=id', settings.anon, undefined, 'GET')
  assert.ok([401, 403].includes(privateData.status))
  assert.equal((await fetch(base + '/rest/v1/', { headers: { Origin: 'https://other.example' } })).status, 403)
  assert.equal((await request('/auth/v1/logout?scope=local', token, {})).status, 204)
  assert.equal((await request('/rest/v1/rpc/my_products', token, {})).data.ok, false)
  ok('real signup/login, persisted account, role boundaries, idempotency and logout')
} finally {
  if (userId) {
    const account = await request('/rest/v1/account?auth_user_id=eq.' + userId, settings.service, undefined, 'DELETE')
    assert.equal(account.status, 204, 'Remove only the synthetic account')
    const user = await request('/auth/v1/admin/users/' + userId, settings.service, undefined, 'DELETE')
    assert.equal(user.status, 200, 'Remove only the synthetic Auth user')
  }
}
console.log('Docker smoke passed. No hardware or agronomic validation is implied.')
