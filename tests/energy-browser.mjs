import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8')),base='http://127.0.0.1:54321'
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label,roles){const email=`energy-browser-${run}-${label}@example.test`;const r=await fetch(base+'/auth/v1/signup',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);const auth=await r.json();const a=await fetch(base+'/rest/v1/rpc/ensure_my_account',{method:'POST',headers:{apikey:config.anon,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:'{}'});const w=await a.json();assert.equal(w.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(w.account.id)}`);return{email,id:w.account.id,token:auth.access_token,userId:auth.user.id}}
const owner=await account('owner',['owner']),operator=await account('operator',['owner','operator'])
const device=randomUUID(),product=randomUUID(),keys=generateKeyPairSync('ed25519'),publicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')
sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('EUI-'+run)},'single_pot','Synthetic browser software test only');INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(Buffer.alloc(32,3).toString('base64'))});INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(product)},${q(owner.id)},clock_timestamp()-interval '2 days');`)
await mkdir('.tmp/phase4/browser',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'UTC',reducedMotion:'reduce'})
const panel=page.getByRole('region',{name:'Akun & kepemilikan produk online',exact:true}),energy=panel.getByRole('region',{name:'Bukti energi meter',exact:true}),errors=[],checks=[]
page.on('pageerror',err=>errors.push(err.message))
async function waitEnergy(){await page.waitForFunction(()=>document.getElementById('energy-heading')?.closest('section')?.querySelector('[aria-busy]')?.getAttribute('aria-busy')==='false')}
async function login(email){await panel.getByLabel('Email',{exact:true}).fill(email);await panel.getByLabel('Kata sandi',{exact:true}).fill(password);await panel.getByRole('button',{name:'Masuk',exact:true}).click();await energy.waitFor();await waitEnergy()}
async function logout(){await panel.getByRole('button',{name:'Keluar',exact:true}).click();await panel.getByRole('button',{name:'Masuk',exact:true}).waitFor();assert.equal(await energy.count(),0)}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:4178/#ekosistem');await login(operator.email)
 await energy.getByText('Pengaturan meter oleh operator',{exact:true}).click()
 assert.equal(await energy.getByLabel('Kunci publik meter Ed25519 (base64)',{exact:true}).inputValue(),'')
 await energy.getByLabel('UUID perangkat untuk meter',{exact:true}).fill(device)
 await energy.getByLabel('Kunci publik meter Ed25519 (base64)',{exact:true}).fill(publicKey)
 await energy.getByLabel('Referensi bukti kalibrasi meter',{exact:true}).fill('Synthetic software-browser key only; NO physical calibration. local://'+run+'x'.repeat(140))
 await energy.getByLabel('Referensi verifikasi beban layak',{exact:true}).fill('Synthetic useful-load fixture only; no physical device certified')
 await energy.getByLabel('Mulai berlaku meter',{exact:true}).fill(new Date(Date.now()-86400000).toISOString().slice(0,16))
 await energy.getByLabel('Akhir berlaku meter',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16))
 await energy.getByLabel('Batas daya meter (W)',{exact:true}).fill('100')
 await energy.getByRole('button',{name:'Daftarkan meter',exact:true}).click()
 await energy.getByRole('status').filter({hasText:'Registrasi meter tersimpan'}).waitFor();await waitEnergy()
 const meter=sql(`SELECT id FROM energy_meter WHERE device_id=${q(device)} AND status='active'`);assert.match(meter,/^[0-9a-f-]{36}$/)
 checks.push('Real server operator registers blank-start meter form with explicit synthetic provenance; no private keys enter UI')
 const end=Math.floor(Date.now()/900000)*900000,value={domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:meter,device_id:device,boot_id:randomUUID(),sequence:0,start_at:new Date(end-900000).toISOString(),end_at:new Date(end).toISOString(),clock_status:'synced',solar_start_wh:0,solar_end_wh:10,load_start_wh:0,load_end_wh:5,battery_soc_pct:null},payload=JSON.stringify(value),signature=sign(null,Buffer.from(payload),keys.privateKey).toString('base64')
 const ingestion=await fetch(base+'/functions/v1/energy-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature})});assert.equal(ingestion.status,200);assert.equal((await ingestion.json()).ok,true)
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await energy.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Operator overflow at ${width}`);await energy.screenshot({path:`.tmp/phase4/browser/energy-operator-${width}.png`})}
 await logout();await login(owner.email)
 assert.equal(await energy.getByText('Pengaturan meter oleh operator',{exact:true}).count(),0)
 await energy.getByText('Panen 10 Wh · Beban 5 Wh · Layak 5 Wh',{exact:true}).waitFor()
 await energy.getByText(/SOC tidak diukur/).waitFor()
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await energy.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Owner overflow at ${width}`);await energy.screenshot({path:`.tmp/phase4/browser/energy-owner-${width}.png`})}
 await page.reload();await waitEnergy();await energy.getByText('Panen 10 Wh · Beban 5 Wh · Layak 5 Wh',{exact:true}).waitFor()
 checks.push('Actual signed ingress visible after reload; owned evidence, minWh, NULL SOC and UTC times; operator controls absent for owner')
 await logout();await login(operator.email);await energy.getByText('Pengaturan meter oleh operator',{exact:true}).click()
 await energy.getByRole('combobox',{name:'Meter untuk dicabut',exact:true}).selectOption(meter)
 await energy.getByLabel('Alasan pencabutan meter',{exact:true}).fill('Synthetic browser revocation; no hardware involved')
 await energy.getByRole('button',{name:'Cabut meter',exact:true}).click();await energy.getByRole('status').filter({hasText:'Meter dicabut'}).waitFor();await waitEnergy()
 assert.equal(sql(`SELECT status FROM energy_meter WHERE id=${q(meter)}`),'revoked')
 const replay=await fetch(base+'/functions/v1/energy-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature})});assert.equal(replay.status,403)
 checks.push('Operator revokes meter through UI; valid previously signed replay is rejected afterwards')
 sql(`DELETE FROM auth.sessions WHERE user_id=${q(operator.userId)}`)
 await energy.getByRole('button',{name:'Muat ulang energi',exact:true}).click();await panel.getByRole('button',{name:'Masuk',exact:true}).waitFor();assert.equal(await energy.count(),0)
 checks.push('Server-revoked Auth session clears private panels; owner/operator layouts at 320/390/1440 without horizontal overflow')
 assert.deepEqual(errors,[])
 const report={checks,widths:[320,390,1440],errors,physicalVerification:false};await writeFile('.tmp/phase4/browser/energy-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(err){await page.screenshot({path:'.tmp/phase4/browser/energy-failure.png',fullPage:true});throw err}finally{await browser.close()}
