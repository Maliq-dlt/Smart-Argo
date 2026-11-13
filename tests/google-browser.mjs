import assert from 'node:assert/strict'
import {createHash,randomUUID,randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdir,readFile} from 'node:fs/promises'
import {gate,signOut} from './entry-helpers.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const curtainOpen=page=>page.waitForFunction(()=>{const c=document.querySelector('.curtain');return !c||c.dataset.state==='open'})
// Google itself is mocked (no client ID in tests): Auth's /authorize is answered with the redirect Google+Auth would
// produce, and /token?grant_type=pkce checks the PKCE pair before returning a real session from local Auth.
const config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8')),base='http://127.0.0.1:54321'
const app=process.env.TEST_URL||'http://127.0.0.1:4178/#ekosistem'
const run=randomUUID().slice(0,8),email=`google-${run}@example.test`,password=randomBytes(20).toString('base64url'),code=randomBytes(18).toString('base64url')
const signup=await fetch(base+'/auth/v1/signup',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json'},body:JSON.stringify({email,password})})
assert.equal(signup.status,200)
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
const avatar=page.getByRole('button',{name:/^Akun: /})
const errors=[],checks=[];page.on('pageerror',err=>errors.push(err.message))
let challenge=null,authorize=null,exchanged=0
await page.route('**/auth/v1/settings',async route=>{const response=await route.fetch();const body=await response.json();body.external.google=true;await route.fulfill({response,json:body})})
await page.route('**/auth/v1/authorize?**',async route=>{
  authorize=new URL(route.request().url());challenge=authorize.searchParams.get('code_challenge')
  const back=new URL(authorize.searchParams.get('redirect_to'))
  // First visit grants consent; the next one is cancelled at Google.
  back.search=exchanged?'?error=access_denied&error_description=Pengguna+membatalkan':`?code=${code}`
  await route.fulfill({status:302,headers:{location:back.href}})
})
await page.route('**/auth/v1/token?grant_type=pkce',async route=>{
  const body=route.request().postDataJSON()
  assert.equal(body.auth_code,code)
  assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge,'verifier must hash to the challenge sent to /authorize')
  exchanged++
  const session=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json'},body:JSON.stringify({email,password})})
  await route.fulfill({status:session.status,json:await session.json()})
})
try{
  await page.goto(app);await curtainOpen(page)
  const google=gate(page).getByRole('button',{name:'Lanjut dengan Google',exact:true})
  await google.waitFor()
  assert.equal(await gate(page).locator('details.signin-email').evaluate(d=>d.open),false)
  assert.equal(await gate(page).getByRole('button',{name:'Coba tanpa akun',exact:true}).count(),1)
  checks.push('Gate offers Google first when Auth enables it, then guest; email form folded')
  await google.click()
  await avatar.waitFor()
  assert.equal(authorize.searchParams.get('provider'),'google')
  assert.equal(authorize.searchParams.get('code_challenge_method'),'s256')
  assert.equal(new URL(page.url()).search,'','single-use code removed from the address bar')
  assert.equal(new URL(page.url()).hash,'#statistik','Google returns to the dashboard')
  assert.equal(exchanged,1)
  checks.push('PKCE: S256 challenge sent, verifier matches, code exchanged once and stripped from the URL')
  await page.reload();await avatar.waitFor()
  assert.equal(exchanged,1,'reload restores the stored session without replaying the code')
  checks.push('reload restores the session without a second exchange')
  await signOut(page)
  await google.click()
  await gate(page).getByRole('alert').filter({hasText:'Masuk dengan Google tidak selesai: Pengguna membatalkan'}).waitFor()
  assert.equal(await avatar.count(),0)
  checks.push('cancelled consent shows the reason and stays signed out')
  await gate(page).getByRole('button',{name:'Coba tanpa akun',exact:true}).click()
  await page.getByRole('button',{name:'Akun: Tamu',exact:true}).waitFor()
  assert.equal(new URL(page.url()).hash,'#statistik')
  await page.evaluate(()=>{location.hash='#profil'})
  await page.locator('#main').getByRole('link',{name:'Masuk',exact:true}).waitFor()
  await page.reload();await page.getByRole('button',{name:'Akun: Tamu',exact:true}).waitFor()
  assert.equal(await gate(page).count(),0,'The guest choice survives a reload')
  checks.push('guest: app opens, profile invites sign-in, choice survives reload')
  await mkdir('.tmp/phase1/browser',{recursive:true});await page.screenshot({path:'.tmp/phase1/browser/google-signin.png'})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({checks,errors},null,2))
}catch(error){
  await mkdir('.tmp/phase1/browser',{recursive:true});await page.screenshot({path:'.tmp/phase1/browser/google-failure.png',fullPage:true})
  throw error
}finally{await browser.close()}
