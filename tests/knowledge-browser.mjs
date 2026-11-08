import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8')),base='http://127.0.0.1:54321'
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url'),species=`Synthetic browser curation ${run}`
async function account(label,roles){const response=await fetch(base+'/auth/v1/signup',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json'},body:JSON.stringify({email:`knowledge-${run}-${label}@example.test`,password})});assert.equal(response.status,200);const user=await response.json();const r=await fetch(base+'/rest/v1/rpc/ensure_my_account',{method:'POST',headers:{apikey:config.anon,Authorization:`Bearer ${user.access_token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);const body=await r.json();assert.equal(body.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(body.account.id)};`);return `knowledge-${run}-${label}@example.test`}
const author=await account('author',['owner','contributor']),curator=await account('curator',['owner','curator'])
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
const panel=page.getByRole('region',{name:'Akun & kepemilikan produk online',exact:true}),knowledge=panel.getByRole('region',{name:'Profil & pengetahuan bersama',exact:true})
const errors=[],checks=[];page.on('pageerror',err=>errors.push(err.message))
await mkdir('.tmp/phase3/browser',{recursive:true})
async function login(email){await panel.getByLabel('Email',{exact:true}).fill(email);await panel.getByLabel('Kata sandi',{exact:true}).fill(password);await panel.getByRole('button',{name:'Masuk',exact:true}).click();await knowledge.getByRole('button',{name:'Muat ulang pengetahuan',exact:true}).waitFor();await knowledge.getByRole('button',{name:'Muat ulang pengetahuan',exact:true}).isEnabled();await page.waitForFunction(()=>{const region=document.getElementById('knowledge-heading')?.closest('section');return region?.querySelector('[aria-busy]')?.getAttribute('aria-busy')==='false'})}
async function logout(){await panel.getByRole('button',{name:'Keluar',exact:true}).click();await panel.getByRole('button',{name:'Masuk',exact:true}).waitFor();assert.equal(await knowledge.count(),0)}
const profile={pot_id:'synthetic-browser-target',crop:'Synthetic browser crop',media:'Test medium',phase:'Test phase',validated:false,ph_validated:false,needs_water:[30,35,40],drained:[70,75,80],next_visit_h:6,hot_c:35,ph_range:[5.5,7]}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:4178/#ekosistem')
 await login(author)
 assert.equal(await knowledge.getByRole('button',{name:'Simpan tinjauan',exact:true}).count(),0)
 const json=knowledge.getByLabel('Parameter Profile (JSON dari pengamatan Anda)',{exact:true})
 assert.equal(await json.inputValue(),'','Contributor JSON must start blank')
 await knowledge.getByLabel('Spesies / varietas',{exact:true}).fill(species)
 await knowledge.getByLabel('Ruang lingkup pengamatan',{exact:true}).fill('Synthetic software-browser test only, not calibrated or agronomically certified')
 await knowledge.getByLabel('Metode, asal data & lisensi berbagi',{exact:true}).fill('Synthetic authored fixture; licensed for software tests only')
 await knowledge.getByLabel('Referensi bukti & keterbatasan',{exact:true}).fill('tests/knowledge-browser.mjs; no physical sensor or field validation')
 await json.fill(JSON.stringify(profile,null,2))
 await knowledge.getByRole('checkbox',{name:/Saya berhak membagikan/}).check()
 await knowledge.getByRole('button',{name:'Kirim kontribusi',exact:true}).click()
 await knowledge.getByRole('status').filter({hasText:'Pengajuan tersimpan'}).waitFor()
 const contribution=sql(`SELECT c.id FROM contribution c JOIN plant_profile p ON p.id=c.profile_id WHERE p.species_variety=${q(species)};`)
 assert.match(contribution,/^[0-9a-f-]{36}$/)
 checks.push('Author role controls and blank JSON; truthful synthetic provenance and affirmative permission submitted through UI')
 await logout();await login(curator)
 assert.equal(await knowledge.getByRole('button',{name:'Kirim kontribusi',exact:true}).count(),0)
 await knowledge.getByRole('combobox',{name:'Pengajuan untuk ditinjau',exact:true}).selectOption(contribution)
 await knowledge.getByRole('combobox',{name:'Keputusan kurator',exact:true}).selectOption('needs_revision')
 await knowledge.getByLabel('Alasan keputusan kurator',{exact:true}).fill('Synthetic test review: clarify the planned observation interval')
 await knowledge.getByLabel('Tingkat bukti yang dinilai',{exact:true}).fill('Software fixture only; no agronomic certification')
 await knowledge.getByRole('button',{name:'Simpan tinjauan',exact:true}).click()
 await knowledge.getByRole('status').filter({hasText:'Tinjauan tersimpan'}).waitFor()
 await logout();await login(author)
 const entry=knowledge.locator('details').filter({has:page.locator('summary').filter({hasText:species})})
 await entry.locator('summary').click()
 await entry.getByRole('button',{name:'Perbaiki pengajuan',exact:true}).click()
 assert.equal(await knowledge.getByLabel('Spesies / varietas',{exact:true}).inputValue(),species)
 assert.equal(await knowledge.getByRole('checkbox',{name:/Saya berhak membagikan/}).isChecked(),false)
 await json.fill(JSON.stringify({...profile,next_visit_h:5},null,2))
 await knowledge.getByRole('checkbox',{name:/Saya berhak membagikan/}).check()
 await knowledge.getByRole('button',{name:'Kirim perbaikan',exact:true}).click()
 await knowledge.getByRole('status').filter({hasText:'Pengajuan tersimpan'}).waitFor()
 assert.equal(sql(`SELECT revision_count FROM contribution WHERE id=${q(contribution)}`),'2')
 checks.push('Distinct real curator requests revision; author sees notes and canonical profile context, reconfirms permission, submits expected revision')
 await logout();await login(curator)
 await knowledge.getByRole('combobox',{name:'Pengajuan untuk ditinjau',exact:true}).selectOption(contribution)
 await knowledge.getByRole('combobox',{name:'Keputusan kurator',exact:true}).selectOption('approved')
 await knowledge.getByLabel('Alasan keputusan kurator',{exact:true}).fill('Synthetic test evidence approved only to exercise publication workflow')
 await knowledge.getByLabel('Tingkat bukti yang dinilai',{exact:true}).fill('Synthetic software fixture; NOT field validated')
 await knowledge.getByRole('button',{name:'Simpan tinjauan',exact:true}).click()
 await knowledge.getByRole('status').filter({hasText:'Tinjauan tersimpan'}).waitFor()
 const version=sql(`SELECT id FROM profile_version WHERE contribution_id=${q(contribution)}`)
 await page.reload()
 await knowledge.getByRole('combobox',{name:'Versi profil terbit',exact:true}).selectOption(version)
 await knowledge.getByRole('button',{name:'Buka sumber profil',exact:true}).click()
 await knowledge.getByText('Bukti: Synthetic software fixture; NOT field validated',{exact:true}).waitFor()
 assert.equal(sql(`SELECT parameters_and_scope->>'next_visit_h' FROM profile_version WHERE id=${q(version)}`),'5')
 assert.equal(sql(`SELECT count(*) FROM contribution_revision WHERE contribution_id=${q(contribution)}`),'2')
 const history=knowledge.locator('details').filter({has:page.locator('summary').filter({hasText:species+' · approved'})})
 await history.locator('summary').click()
 await history.getByText(/Revisi 1.*needs_revision/).waitFor()
 checks.push('Distinct curator publishes revision2; metadata, source, immutable revisions and review history persist after reload')
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await knowledge.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Horizontal overflow at ${width}`);await knowledge.screenshot({path:`.tmp/phase3/browser/knowledge-${width}.png`})}
 assert.deepEqual(errors,[])
 await writeFile('.tmp/phase3/browser/knowledge-report.json',JSON.stringify({checks,widths:[1440,390,320],errors},null,2))
 console.log(JSON.stringify({checks,widths:[1440,390,320],errors},null,2))
}catch(error){await page.screenshot({path:'.tmp/phase3/browser/knowledge-failure.png',fullPage:true});throw error}finally{await browser.close()}
