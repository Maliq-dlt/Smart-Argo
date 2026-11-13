import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {gate,signIn,signOut,ecosystemTab} from './entry-helpers.mjs'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {enableTotp,totp} from './totp.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
// SelectField (Radix): open the trigger, then choose the option by its value.
const pick=async(scope,name,value)=>{await scope.getByRole('combobox',{name,exact:true}).click();await scope.page().locator(`[role=option][data-value="${value}"]`).click()}
// The site curtain (loading screen) covers the first paint; interact only once it has lifted, like a visitor would.
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
// With Google sign-in enabled the email form starts folded; open it the way a visitor would.
const config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8')),base='http://127.0.0.1:54321'
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body){const response=await fetch(base+path,{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return{status:response.status,data:await response.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url'),title=`Synthetic UI reward ${run}`,version=`synthetic-browser-${run}`
async function account(label,roles){const email=`reward-browser-${run}-${label}@example.test`,r=await api('/auth/v1/signup',null,{email,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`);return{email,token:r.data.access_token,id:a.data.account.id}}
const operator=await account('operator',['owner','operator']),owner=await account('owner',['owner'])
// The owner redeems, so 2FA is on and the 24 h hold after enabling it is backdated away.
Object.assign(owner,await enableTotp(base,config.anon,owner.token));sql(`UPDATE security_event SET created_at=created_at-interval '25 hours' WHERE kind='mfa_enabled' AND user_id=(SELECT auth_user_id FROM account WHERE id=${q(owner.id)})`)
const previous=(await rpc('reward_workspace',operator.token)).data.policy
const product=randomUUID(),device=randomUUID(),keys=generateKeyPairSync('ed25519'),raw=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')
// Synthetic product/ownership provisioning only; energy packet below traverses real signature and policy endpoints.
sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('RUI-'+run)},'single_pot','synthetic browser fixture'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(raw)}); INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(product)},${q(owner.id)},clock_timestamp()-interval '1 day');`)
let meter
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
const panel=page,rewards=page.getByRole('region',{name:'Poin & penukaran program',exact:true})
const errors=[],checks=[];page.on('pageerror',err=>errors.push(err.message));await mkdir('.tmp/phase4/browser',{recursive:true})
async function ready(){await page.waitForFunction(()=>document.getElementById('reward-heading')?.closest('section')?.querySelector('[aria-busy]')?.getAttribute('aria-busy')==='false')}
async function login(person){await signIn(page,person.email,password);if(person.secret){await panel.getByLabel('Kode autentikator',{exact:true}).fill(totp(person.secret));await panel.getByRole('button',{name:'Verifikasi',exact:true}).click()}await ecosystemTab(page,'Energi & reward');await rewards.waitFor();await ready()}
async function logout(){await signOut(page);assert.equal(await rewards.count(),0)}
async function balance(confirmed,reserved,available){const expected=[confirmed,reserved,available];assert.deepEqual(await rewards.locator('dl dd').allTextContents(),expected.map(String))}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:4178/#ekosistem');await login(operator); await curtainOpen(page)
 await rewards.getByLabel('Versi kebijakan reward',{exact:true}).fill(version)
 await rewards.getByLabel('Wh per poin (ditetapkan program)',{exact:true}).fill('5')
 await rewards.getByLabel('Batas poin harian per akun (UTC)',{exact:true}).fill('100')
 await rewards.getByRole('button',{name:'Aktifkan versi kebijakan',exact:true}).click();await ready()
 await rewards.getByText(new RegExp('Kebijakan aktif: '+version)).waitFor()
 const energyPanel=panel.getByRole('region',{name:'Bukti energi meter',exact:true})
 await energyPanel.locator('summary').filter({hasText:'Pengaturan meter oleh operator'}).click()
 await energyPanel.getByLabel('UUID perangkat untuk meter',{exact:true}).fill(device)
 await energyPanel.getByLabel('Kunci publik meter Ed25519 (base64)',{exact:true}).fill(raw)
 await energyPanel.getByLabel('Referensi bukti kalibrasi meter',{exact:true}).fill('Synthetic browser meter; NOT physically calibrated')
 await energyPanel.getByLabel('Referensi verifikasi beban layak',{exact:true}).fill('Synthetic software eligible-load evidence only')
 const local=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
 await energyPanel.getByLabel('Mulai berlaku meter',{exact:true}).fill(local(Date.now()-86400000))
 await energyPanel.getByLabel('Akhir berlaku meter',{exact:true}).fill(local(Date.now()+86400000))
 await energyPanel.getByLabel('Batas daya meter (W)',{exact:true}).fill('1000')
 await energyPanel.getByRole('button',{name:'Daftarkan meter',exact:true}).click()
 await energyPanel.getByRole('status').filter({hasText:'Registrasi meter tersimpan'}).waitFor()
 meter={meter_id:sql(`SELECT id FROM energy_meter WHERE device_id=${q(device)} AND status='active'`)}
 assert.match(meter.meter_id,/^[0-9a-f-]{36}$/)

 await rewards.getByLabel('Nama item katalog',{exact:true}).fill(title);await rewards.getByLabel('Biaya poin item',{exact:true}).fill('4');await rewards.getByLabel('Stok saat ini termasuk reservasi',{exact:true}).fill('3')
 await pick(rewards,'Ketersediaan item katalog','available')
 await rewards.getByRole('button',{name:'Simpan katalog',exact:true}).click();await ready()
 const item=sql(`SELECT id FROM catalog_item WHERE title=${q(title)};`);assert.match(item,/^[0-9a-f-]{36}$/)
 const end=Math.floor(Date.now()/900000)*900000,payload=JSON.stringify({domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:meter.meter_id,device_id:device,boot_id:randomUUID(),sequence:0,start_at:new Date(end-900000).toISOString(),end_at:new Date(end).toISOString(),clock_status:'synced',solar_start_wh:0,solar_end_wh:75,load_start_wh:0,load_end_wh:50,battery_soc_pct:null})
 const energy=await api('/functions/v1/energy-ingest',null,{payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')});assert.equal(energy.status,200,JSON.stringify(energy.data));assert.equal(energy.data.credited,10)
 checks.push('Operator sets explicit policy and inventory through UI; real Ed25519 endpoint credits synthetic eligible meter energy')
 await logout();await login(owner);await balance(10,0,10)
 assert.equal(await rewards.getByRole('button',{name:'Aktifkan versi kebijakan',exact:true}).count(),0)
 assert.equal(await rewards.getByRole('button',{name:'Simpan katalog',exact:true}).count(),0)
 const reserve=rewards.getByRole('button',{name:'Reservasi '+title,exact:true})
 let lost=true
 await page.route('**/rest/v1/rpc/reserve_my_reward',async route=>{if(lost){lost=false;await route.fetch();await route.abort('failed')}else await route.continue()})
 await reserve.click();await ready();await rewards.getByRole('alert').waitFor();await reserve.click();await ready()
 assert.equal(sql(`SELECT count(*) FROM redemption WHERE account_id=${q(owner.id)} AND catalog_item_id=${q(item)}`),'1');await balance(10,4,6)
 await page.unroute('**/rest/v1/rpc/reserve_my_reward')
 const cancel=rewards.getByRole('button',{name:'Batalkan reservasi '+title,exact:true});await cancel.click();await ready();await balance(10,0,10)
 // Step-up: the server asks for a fresh code once; the UI verifies the typed code with Auth and retries the same request.
 let stepUp=true
 await page.route('**/rest/v1/rpc/reserve_my_reward',async route=>{if(stepUp){stepUp=false;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:false,code:'step_up_required'})})}else await route.continue()})
 await rewards.getByLabel('Kode 2FA untuk penukaran',{exact:true}).fill(totp(owner.secret))
 await reserve.click();await ready();await balance(10,4,6);assert.equal(stepUp,false);await page.unroute('**/rest/v1/rpc/reserve_my_reward')
 await cancel.click();await ready();await balance(10,0,10)
 checks.push('Owner signs in with a TOTP code; a step-up request verifies the typed code and retries the reservation once')
 let failedRefresh=true
 await page.route('**/rest/v1/rpc/reward_workspace',async route=>{if(failedRefresh){failedRefresh=false;await route.abort('failed')}else await route.continue()})
 await reserve.click();await ready();await rewards.getByRole('alert').waitFor();await reserve.click();await ready();await page.unroute('**/rest/v1/rpc/reward_workspace')
 assert.equal(sql(`SELECT count(*) FROM redemption WHERE account_id=${q(owner.id)} AND catalog_item_id=${q(item)}`),'3');await balance(10,4,6)
 const redemption=sql(`SELECT id FROM redemption WHERE account_id=${q(owner.id)} AND catalog_item_id=${q(item)} AND status='reserved'`)
 checks.push('Owner-only controls; stable request identity survives lost server response and failed workspace refresh; cancellation releases points/stock')
 await logout();await login(operator)
 await pick(rewards,'Reservasi untuk direalisasikan',redemption)
 await rewards.getByLabel('Referensi realisasi operator',{exact:true}).fill('Synthetic browser fulfillment record; no external shipment')
 await rewards.getByRole('button',{name:'Catat realisasi & debit poin',exact:true}).click();await ready()
 assert.equal(sql(`SELECT signed_points FROM ledger_entry WHERE redemption_id=${q(redemption)} AND reversal_of IS NULL`),'-4')
 const stock=sql(`SELECT stock_total FROM catalog_item WHERE id=${q(item)}`)
 await pick(rewards,'Realisasi untuk dikompensasi',redemption)
 await rewards.getByLabel('Alasan kompensasi poin',{exact:true}).fill('Synthetic UI test compensation; physical inventory not returned')
 await rewards.getByRole('button',{name:'Kompensasi poin tanpa restok',exact:true}).click();await ready()
 assert.equal(sql(`SELECT sum(signed_points) FROM ledger_entry WHERE redemption_id=${q(redemption)}`),'0');assert.equal(sql(`SELECT stock_total FROM catalog_item WHERE id=${q(item)}`),stock)

 const energyPanelAfter=panel.getByRole('region',{name:'Bukti energi meter',exact:true})
 await energyPanelAfter.locator('summary').filter({hasText:'Pengaturan meter oleh operator'}).click()
 await pick(energyPanelAfter,'Meter untuk dicabut',meter.meter_id)
 await energyPanelAfter.getByLabel('Alasan pencabutan meter',{exact:true}).fill('Synthetic browser test completed; no physical meter attestation')
 await energyPanelAfter.getByRole('button',{name:'Cabut meter',exact:true}).click()
 await energyPanelAfter.getByRole('status').filter({hasText:'Meter dicabut'}).waitFor()
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await rewards.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Operator horizontal overflow at ${width}`);await rewards.screenshot({path:`.tmp/phase4/browser/rewards-operator-${width}.png`})}
 checks.push('Operator registers and revokes synthetic meter through actual UI; operator policy/catalog/fulfillment forms fit all three viewports')
 await logout();await login(owner);await balance(10,0,10)
 await rewards.locator('summary').filter({hasText:'Ledger akun'}).click()
 assert.equal(await rewards.getByText(/Synthetic UI test compensation/).count(),2)
 checks.push('Distinct operator fulfills and compensates; immutable debit/reversal ledger visible to owner, inventory not restocked')
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await rewards.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Horizontal overflow at ${width}`);assert.equal(await rewards.getByRole('button',{name:'Reservasi '+title,exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`Clipped catalogue button at ${width}`);await rewards.screenshot({path:`.tmp/phase4/browser/rewards-${width}.png`})}
 // Revoke the current browser session through its verified JWT, retaining the browser's stateless access token.
 const session=await page.evaluate(()=>{const key=Object.keys(sessionStorage).find(k=>k.startsWith('smart-agro.account:'));return JSON.parse(sessionStorage.getItem(key))})
 const revoked=await api('/auth/v1/logout?scope=local',session.access_token,{});assert.ok([200,204,401].includes(revoked.status))
 await rewards.getByRole('button',{name:'Muat ulang reward',exact:true}).click();await gate(page).waitFor();assert.equal(await rewards.count(),0)
 checks.push('Revoked real Auth session clears reward state while stateless access token remains in browser until rejection')
 assert.deepEqual(errors,[]);await writeFile('.tmp/phase4/browser/rewards-report.json',JSON.stringify({checks,widths:[1440,390,320],errors},null,2));console.log(JSON.stringify({checks,widths:[1440,390,320],errors},null,2))
}catch(error){await page.screenshot({path:'.tmp/phase4/browser/rewards-failure.png',fullPage:true});throw error}finally{if(previous)await rpc('operator_set_reward_policy',operator.token,{p_version:previous.version,p_wh_per_point:previous.wh_per_point,p_daily_cap:previous.daily_point_cap,p_enabled:true});else await rpc('operator_set_reward_policy',operator.token,{p_version:null,p_wh_per_point:null,p_daily_cap:null,p_enabled:false});await browser.close()}
