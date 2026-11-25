import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { startGateway } from '../scripts/backend-gateway.mjs'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { readFile } from 'node:fs/promises'

// SINTETIS. Real local GoTrue, PostgREST, signature verification and SMTP over loopback only.
const base = 'http://127.0.0.1:54321', config = JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const sql = input => execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],
  { input, encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim()
const q = s => "'" + String(s).replaceAll("'", "''") + "'"
const ago = minutes => new Date(Date.now() - minutes*60000).toISOString()
async function post(path, token, body={}) {
  const r = await fetch(base+path,{ method:'POST', headers:{ Connection:'close', apikey:config.anon, Authorization:'Bearer '+token,'Content-Type':'application/json' },
    body:JSON.stringify(body), signal:AbortSignal.timeout(20000) })
  return { status:r.status, data:await r.json() }
}
const rpc = async (name, token, body) => (await post('/rest/v1/rpc/'+name,token,body)).data
async function account() {
  const password=randomBytes(16).toString('hex')
  const { data } = await post('/auth/v1/signup',config.anon,{email:'care-'+randomUUID()+'@example.test',password})
  const a = await rpc('ensure_my_account',data.access_token)
  assert.equal(a.ok,true)
  return { token:data.access_token,id:a.account.id,email:data.user.email,password }
}

// SMTP test sink deliberately accepts one recipient at a time and can reject the DATA command.
async function smtpSink() {
  const messages = [], recipients = []
  const state = { reject:false, dropReply:false }
  const server = createServer(socket => {
    let buf='', inData=false, lines=[]
    socket.setEncoding('utf8')
    socket.write('220 localhost test SMTP\r\n')
    socket.on('data',part=>{
      buf+=part
      let end
      while ((end=buf.indexOf('\r\n'))>=0) {
        const line=buf.slice(0,end);buf=buf.slice(end+2)
        if (inData && line!=='.') {lines.push(line);continue}
        if (inData) {
          inData=false; messages.push(lines.join('\n')); lines=[]
          if (state.dropReply) {socket.resetAndDestroy();return}
          socket.write('250 queued\r\n');continue
        }
        if (line==='QUIT') {socket.end('221 bye\r\n');return}
        if (line.toUpperCase()==='DATA') {
          if (state.reject) socket.write('451 temporary failure\r\n')
          else {inData=true;socket.write('354 continue\r\n')}
        } else {if (/^rcpt to:/i.test(line)) recipients.push(line);socket.write('250 ok\r\n')}
      }
    })
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return { state,messages,recipients, port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve)) }
}

test('owner sensor care, calibration and scheduled mail',async t=>{
  const a=await account(), b=await account(), unit=randomUUID(), product=randomUUID(), device=randomUUID()
  const profile=randomUUID(),version=randomUUID(),contribution=randomUUID(),own=randomUUID()
  const pair=generateKeyPairSync('ed25519'), publicKey=Buffer.from(pair.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')
  const params={pot_id:unit,crop:'fixture',media:'fixture',phase:'fixture',validated:true,ph_validated:false,
    needs_water:[39,40,41],drained:[70,75,80],next_visit_h:6,hot_c:35,ph_range:[5.5,7]}
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('CARE-'+product.slice(0,8))},'garden','SINTETIS');
    INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(publicKey)});
    INSERT INTO ownership(id,account_id,product_id,start_at) VALUES(${q(own)},${q(a.id)},${q(product)},now()-interval '6 days');
    INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(profile)},${q('SINTETIS-'+profile)},'SINTETIS');
    INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status)
      VALUES(${q(contribution)},${q(profile)},${q(a.id)},'SINTETIS','test',${q(JSON.stringify(params))},'approved');
    INSERT INTO review(contribution_id,reviewer_account_id,decision,decision_reason) VALUES(${q(contribution)},${q(b.id)},'approved','SINTETIS');
    INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level,provenance)
      VALUES(${q(version)},${q(profile)},${q(contribution)},1,${q(JSON.stringify(params))},'SINTETIS','{}');
    INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(product)},${q(version)},'Pot uji');
    INSERT INTO device_placement(device_id,unit_id,placed_by,start_at) VALUES(${q(device)},${q(unit)},${q(a.id)},now()-interval '5 days');`)
  const health = (token,other={})=>rpc('my_unit_health',token,{p_unit_id:unit,...other})
  const outlook=(token=a.token,extra={})=>rpc('my_watering_outlook',token,{p_unit_id:unit,...extra})
  const rises=(token=a.token,extra={})=>rpc('my_unlogged_rises',token,{p_unit_id:unit,...extra})
  const setPref = (enabled,kinds)=>rpc('set_my_alert_preferences',a.token,{p_email_enabled:enabled,p_kinds:kinds})
  const queue = async () => (await rpc('evaluate_alerts',config.service)).filter(job=>job.account_id===a.id)
  async function ingest(min,v,temp=25,extra={}) {
    const payload=JSON.stringify({domain:'smart-agro.telemetry.v2',schema_version:2,source:'device',unit_id:unit,device_id:device,boot_id:randomUUID(),
      sequence:1,clock_status:'synced',measured_at:ago(min),sensors:{moisture:{status:'ok',value:v},soil_temperature:{status:'ok',value:temp},
        soil_ph:{status:'not_measured',value:null}},...extra})
    return post('/functions/v1/telemetry-ingest',config.anon,{payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')})
  }
  async function sample(...args) {const r=await ingest(...args);assert.equal(r.status,200,JSON.stringify(r))}
  const cal={moisture_at:ago(5000),ph_at:null}
  await t.test('owner-only data and bounded local days, including an empty unit',async()=>{
    assert.equal((await health(b.token)).code,'unit_unavailable')
    assert.equal((await outlook(b.token)).code,'unit_unavailable')
    assert.equal((await rises(b.token)).code,'unit_unavailable')
    assert.equal((await post('/rest/v1/rpc/my_overview',config.anon)).status,401)
    const fresh=await post('/auth/v1/signup',config.anon,{email:'fresh-'+randomUUID()+'@example.test',password:randomBytes(16).toString('hex')})
    for(const [method,body] of [['my_overview',{}],['my_alert_preferences',{}],['my_unit_health',{p_unit_id:unit}],['my_watering_outlook',{p_unit_id:unit}]])
      assert.equal((await rpc(method,fresh.data.access_token,body)).code,'account_required')
    assert.deepEqual(await rpc('my_overview',b.token),{ok:true,plants:[],devices:{total:0,issues:[]}})
    for(const p_days of [0,31,null]) assert.equal((await health(a.token,{p_days})).code,'invalid_request')
    assert.equal((await health(a.token,{p_timezone:'Bad/Zone'})).code,'invalid_request')
    const h=await health(a.token)
    assert.equal(h.ok,true,JSON.stringify(h));assert.deepEqual(h.battery,[]);assert.deepEqual(h.energy_days,[])
    assert.equal(h.calibration,null);assert.equal((await outlook()).outlook.state,'waiting');assert.deepEqual((await rises()).rises,[])
  })
  await t.test('a measured drying rate produces an owner forecast with the pinned pot threshold',async()=>{
    await sample(1600,78)
    for (let i=0;i<6;i++) await sample(224-i*30,62.5-i*0.5)
    const timezone=Intl.supportedValuesOf('timeZone').find(zone=>
      Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:zone}).format(new Date(ago(74))))===13)
    const {outlook:w}=await outlook(a.token,{p_timezone:timezone})
    assert.equal(w.state,'window');assert.deepEqual(w.band,[40,85]);assert.equal(w.rate_per_hour,1)
    await sample(73,59.7)
    const uneven=await outlook(a.token,{p_timezone:timezone})
    assert.equal(uneven.outlook.rate_per_hour,1.11,'a one-minute interval contributes one minute to the combined rate')
    assert.ok(Date.parse(w.from)<Date.parse(w.to));assert.ok(Date.parse(w.from)>Date.now())
    assert.equal((await outlook(a.token,{p_timezone:'Bad/Zone'})).code,'invalid_request')

  })
  await t.test('signed optional calibration dates and a read-only moisture rise followed by explicit watering',async()=>{
    await sample(1500,52)
    await sample(65,30)
    await sample(35,37,25,{calibration:cal})
    assert.equal((await ingest(32,32,25,{calibration:{ph_at:'2038-02-30T13:00:00Z'}})).status,400)
    assert.equal((await ingest(32,32,25,{calibration:{ph_at:ago(-360)}})).status,400)
    assert.deepEqual((await health(a.token)).calibration,cal)
    let suggestion
    for(let i=0;i<2;i++){
      const r=await rises()
      assert.equal(r.ok,true);assert.equal(r.rises.length,1);suggestion=r.rises[0]
    }
    assert.equal(suggestion.delta,7)
    assert.equal((await rpc('dismiss_my_rise',b.token,{p_unit_id:unit,p_at:suggestion.to})).code,'unit_unavailable')
    assert.equal((await rpc('dismiss_my_rise',a.token,{p_unit_id:unit,p_at:ago(40)})).code,'rise_unavailable')
    assert.equal((await rises(a.token,{p_days:31})).code,'invalid_request')
    assert.equal(sql(`SELECT count(*) FROM care_journal WHERE unit_id=${q(unit)}`),'0')
    const body={p_unit_id:unit,p_request_id:randomUUID(),p_kind:'watering',p_observed_at:suggestion.to,p_amount_ml:150,p_notes:'Terdeteksi dari sensor'}
    assert.equal((await rpc('append_my_care_journal',a.token,body)).ok,true)
    assert.equal((await rpc('append_my_care_journal',a.token,body)).idempotent,true)
    assert.deepEqual((await rises()).rises,[])
    // Close to the confirmed journal, so use a separate, older event to test dismissal across sessions.
    await sample(700,18);await sample(670,26)
    const [old]=(await rises()).rises;assert.equal(old.delta,8)
    const otherSession=(await post('/auth/v1/token?grant_type=password',config.anon,{email:a.email,password:a.password})).data.access_token
    await sample(640,29) // The displayed endpoint is still dismissible after another rising sample.
    for(let i=0;i<2;i++) assert.equal((await rpc('dismiss_my_rise',a.token,{p_unit_id:unit,p_at:old.to})).ok,true)
    await sample(610,33)
    assert.deepEqual((await rises(otherSession)).rises,[])
    assert.equal(sql(`SELECT count(*) FROM care_journal WHERE unit_id=${q(unit)}`),'1')
  })
  await t.test('96 quarter-hour windows count toward the local day on which they begin',async()=>{
    const meter=randomUUID()
    sql(`INSERT INTO energy_meter(id,device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by)
      VALUES(${q(meter)},${q(device)},${q(publicKey)},'SINTETIS','SINTETIS',now()-interval '5 days',now()+interval '1 day',100,${q(a.id)});
      INSERT INTO energy_window(device_id,boot_id,start_at,end_at,solar_harvest_wh,load_wh,evidence_quality,meter_id,ownership_id,solar_start_wh,solar_end_wh,load_start_wh,load_end_wh)
      SELECT ${q(device)},'energy-test',midnight+n*interval '15 min',midnight+(n+1)*interval '15 min',2,1,'verified_meter',
        ${q(meter)},${q(own)},2*n,2*n+2,n,n+1 FROM generate_series(0,95) n,
        (SELECT (((now() AT TIME ZONE 'Asia/Jakarta')::date-2)::timestamp AT TIME ZONE 'Asia/Jakarta') AS midnight) d`)
    const days=(await health(a.token)).energy_days
    assert.equal(days.length,1);assert.deepEqual([days[0].windows,days[0].solar_wh,days[0].load_wh],[96,192,96])
    assert.equal((await health(a.token,{p_timezone:'UTC'})).energy_days.length,2)
  })
  await t.test('alerts need opt-in, fresh evidence and service credentials',async()=>{
    assert.equal((await rpc('my_alert_preferences',a.token)).email_enabled,false)
    assert.equal((await post('/rest/v1/rpc/evaluate_alerts',a.token)).status,403)
    assert.equal((await setPref(true,['none'])).code,'invalid_request')
    await sample(24,30,36,{battery:{status:'ok',value:3.2}})
    assert.deepEqual(await queue(),[])
    await setPref(true,['soil_dry','battery_low','soil_hot'])
    const list=await queue()
    assert.deepEqual(list.map(j=>j.kind).sort(),['battery_low','soil_dry'])
    const h=await health(a.token);assert.equal(h.battery.at(-1).volts,3.2)
    const job=list.find(j=>j.kind==='battery_low')
    const claims=await Promise.all([randomUUID(),randomUUID()].map(async token=>({token,claim:await rpc('claim_alert_delivery',config.service,{p_episode_id:job.id,p_token:token})})))
    assert.equal(claims.filter(c=>c.claim).length,1)
    assert.equal(await rpc('finish_alert_delivery',config.service,{p_episode_id:job.id,p_token:claims.find(c=>c.claim).token,p_sent:false}),true)
    await setPref(true,['soil_dry'])
  })
  await t.test('scheduled worker retries SMTP, delivers once, purges due accounts and rearms only on two normal readings',async()=>{
    const sink=await smtpSink()
    const secret=randomBytes(32).toString('hex')
    const env={ALERT_DISPATCH_SECRET:secret,SMTP_HOST:'127.0.0.1',SMTP_PORT:String(sink.port),SMTP_MODE:'local',SMTP_FROM:'agro@example.test',
      ALERT_APP_URL:'https://app.example.test'}
    const gateway=startGateway({settings:config,port:0,appOrigin:base,alertEnv:key=>env[key],log:()=>{}})
    await once(gateway,'listening')
    const url='http://127.0.0.1:'+gateway.address().port+'/functions/v1/alert-dispatch'
    const work=async(token=secret)=>{
      const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)})
      return {...await r.json(),status:r.status}
    }
    try {
      assert.equal((await work(a.token)).status,403)
      const closed=await smtpSink()
      await closed.close()
      env.SMTP_PORT=String(closed.port)
      const refused=await work()
      assert.equal(refused.failed,1,'a refused TCP connection can be retried')
      assert.equal(refused.uncertain,0)
      assert.equal((await queue()).length,1)
      env.SMTP_PORT=String(sink.port)
      sink.state.reject=true
      const rejected=await work();assert.equal(rejected.status,503);assert.equal(rejected.failed,1)
      assert.equal((await queue()).length,1)
      const due=await account()
      assert.equal((await rpc('set_my_alert_preferences',due.token,{p_email_enabled:true,p_kinds:['soil_hot']})).ok,true)
      assert.equal((await rpc('request_account_deletion',due.token)).ok,true)
      sql(`UPDATE account_deletion SET requested_at=now()-interval '15 days',purge_after=now()-interval '1 day' WHERE account_id=${q(due.id)}`)
      sink.state.reject=false
      const report=(await work())
      assert.equal(report.purged,1);assert.equal(report.sent,1)
      assert.equal(sql(`SELECT count(*) FROM alert_preference WHERE account_id=${q(due.id)}`),'0')
      assert.equal((await work()).sent,0)
      assert.equal(sink.messages.length,1);assert.match(sink.messages[0],/Peringatan perangkat Smart Agro/)
      assert.match(sink.messages[0],/Dua bacaan/);assert.ok(sink.recipients.some(r=>r.includes(a.email)))
      // Owners read Jakarta time, not a raw UTC stamp, and can find the switch that stops these mails.
      assert.match(sink.messages[0],/Mulai: \d{1,2} [A-Z][a-z]{2} \d{2}\.\d{2} WIB/)
      assert.doesNotMatch(sink.messages[0],/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
      assert.ok(sink.messages[0].includes('https://app.example.test/#pengaturan-peringatan'))
      await sample(18,41);await queue()
      await sample(15,39);await queue()
      assert.equal(sql(`SELECT count(*) FROM alert_episode WHERE unit_id=${q(unit)} AND kind='soil_dry' AND closed_at IS NULL`),'1')
      await sample(12,41);await sample(9,42);await queue()
      assert.equal(sql(`SELECT count(*) FROM alert_episode WHERE unit_id=${q(unit)} AND kind='soil_dry' AND closed_at IS NULL`),'0')
      await sample(6,39);await sample(3,38)
      assert.equal((await queue()).length,1)
      sink.state.dropReply=true
      const lost=await work();assert.equal(lost.status,503);assert.equal(lost.uncertain,1)
      assert.equal(sink.messages.length,2)
      assert.equal((await work()).sent,0)
      assert.equal(sink.messages.length,2,'an ambiguous SMTP acceptance never triggers a duplicate')
    } finally {await new Promise(resolve=>gateway.close(resolve));await sink.close()}
  })
  await t.test('a gap breaks heat duration and the silent episode needs two new uploads to recover',async()=>{
    const hotUnit=randomUUID(), hotDevice=randomUUID()
    sql(`INSERT INTO device(id,product_id,public_key) VALUES(${q(hotDevice)},${q(product)},${q(randomBytes(32).toString('base64'))});
      INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(hotUnit)},${q(product)},${q(version)},'Suhu');
      INSERT INTO device_placement(device_id,unit_id,placed_by,start_at) VALUES(${q(hotDevice)},${q(hotUnit)},${q(a.id)},now()-interval '4 days')`)
    const put=(mins,temp,arrival=mins)=>sql(`INSERT INTO telemetry_packet(device_id,unit_id,boot_id,sequence,clock_status,measured_at,received_at,payload,payload_sha256,signature)
      VALUES(${q(hotDevice)},${q(hotUnit)},gen_random_uuid(),1,'synced',${q(ago(mins))},${q(ago(arrival))},
        ${q(JSON.stringify({sensors:{soil_temperature:{status:'ok',value:temp}}}))},'fixture','fixture')`)
    await setPref(true,['soil_hot','device_silent'])
    put(300,36);put(240,36)
    assert.deepEqual((await queue()).map(j=>j.kind),['device_silent'])
    put(91,36);put(60,35)
    assert.equal((await queue()).some(j=>j.kind==='soil_hot'),false)
    put(30,36);put(1,36)
    assert.equal((await queue()).some(j=>j.kind==='soil_hot'),false)
    assert.equal(sql(`SELECT count(*) FROM alert_episode WHERE unit_id=${q(hotUnit)} AND kind='device_silent' AND closed_at IS NULL`),'0')
    put(181,36);put(121,35)
    assert.equal((await queue()).some(j=>j.kind==='soil_hot'),true)
    assert.equal((await health(a.token,{p_device_id:hotDevice})).code,'device_unavailable')
  })
  await t.test('pending deletion, transfer and former placements cannot disclose data or deliver an old email',async()=>{
    await sample(0.2,38,25,{battery:{status:'ok',value:3.2}})
    await setPref(true,['battery_low'])
    const [job]=await queue();assert.ok(job)
    const otherUnit=randomUUID()
    sql(`INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(otherUnit)},${q(product)},${q(version)},'Pot pindahan')`)
    assert.equal((await rpc('place_my_device',a.token,{p_device_id:device,p_unit_id:otherUnit})).ok,true)
    assert.equal((await health(a.token)).device_id,null)
    assert.equal(await rpc('claim_alert_delivery',config.service,{p_episode_id:job.id,p_token:randomUUID()}),null)
    const moved=await health(a.token,{p_unit_id:otherUnit,p_device_id:device})
    assert.equal(moved.device_id,device);assert.deepEqual(moved.packets,[]);assert.deepEqual(moved.energy_days,[])
    assert.equal((await rpc('place_my_device',a.token,{p_device_id:device,p_unit_id:unit})).ok,true)
    assert.equal((await rpc('request_account_deletion',a.token)).ok,true)
    assert.deepEqual(await queue(),[])
    assert.equal(await rpc('claim_alert_delivery',config.service,{p_episode_id:job.id,p_token:randomUUID()}),null)
    sql(`INSERT INTO ownership(account_id,product_id) VALUES(${q(b.id)},${q(product)})`)
    const h=await health(b.token)
    assert.deepEqual(h.battery,[]);assert.deepEqual(h.energy_days,[]);assert.equal(h.calibration,null)
  })
  await t.test('a solar battery that dips every night recovers only after a full healthy day',async()=>{
    // SINTETIS. Half-hourly battery readings for a fresh probe; low marks the hours given, the rest follow `rest`.
    const cell=(hours,low,rest)=>{
      const u=randomUUID(),d=randomUUID()
      sql(`INSERT INTO device(id,product_id,public_key) VALUES(${q(d)},${q(product)},${q(randomBytes(32).toString('base64'))});
        INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(u)},${q(product)},${q(version)},'Baterai');
        INSERT INTO device_placement(device_id,unit_id,placed_by,start_at) VALUES(${q(d)},${q(u)},${q(a.id)},now()-interval '3 days');
        INSERT INTO telemetry_packet(device_id,unit_id,boot_id,sequence,clock_status,measured_at,received_at,payload,payload_sha256,signature)
          SELECT ${q(d)},${q(u)},gen_random_uuid(),1,'synced',now()-h*interval '1 hour',now()-h*interval '1 hour',
            jsonb_build_object('battery',jsonb_build_object('status','ok','value',CASE WHEN ${low} THEN 3.35 ELSE ${rest} END))::text,'fixture','fixture'
          FROM generate_series(0.2,${hours},0.5) h`)
      return sql(`SELECT coalesce(good_at::text,'none') FROM care_alert_signals(${q(u)},${q(d)},now()-interval '3 days',NULL) WHERE kind='battery_low'`)
    }
    // Low last night, 12 sunny hours at 3.95 V, an evening at 3.5 V (between the thresholds), low again now.
    assert.equal(cell(30,'h>=29.5 OR h<=0.5','CASE WHEN h>17 THEN 3.95 ELSE 3.5 END'),'none','a sunny day inside 24 h of a low reading')
    // Low two days ago, then a full day at 3.95 V: recovered, so the next dip may mail again.
    assert.notEqual(cell(46,'h>=45.5','3.95'),'none','24 h at or above 3.6 V')
  })
})

test('garden overview and sensor trends from seven days of half-hourly readings', async t => {
  const owner = await account()
  const outsider = await account()
  const { id, token } = owner
  const overview = () => rpc('my_overview', token)
  const baseParams = { crop:'fixture', media:'fixture', phase:'fixture', validated:true, ph_validated:false,
    needs_water:[39,40,41], drained:[70,75,80], next_visit_h:6, hot_c:35, ph_range:[5.5,7] }
  // SINTETIS. Thirty occupied pots, one probe each, with real measurement rows and separate pot profiles.
  const rows = JSON.parse(sql(`BEGIN;
    CREATE TEMP TABLE pots AS SELECT i, gen_random_uuid() AS unit, gen_random_uuid() AS device,
      gen_random_uuid() AS product, gen_random_uuid() AS slot, gen_random_uuid() AS version,
      gen_random_uuid() AS contribution, gen_random_uuid() AS profile, gen_random_uuid() AS boot
      FROM generate_series(1,30) i;
    CREATE TEMP TABLE sites AS SELECT g,gen_random_uuid() AS site FROM generate_series(0,2) g;
    INSERT INTO garden_site(id,account_id,name,kind,placement)
      SELECT site,${q(id)},'Kebun '||g,'garden','indoor' FROM sites;
    INSERT INTO product(id,serial_public,variant,issuer_signature)
      SELECT product,'OV-'||product,'garden','SINTETIS' FROM pots;
    INSERT INTO ownership(account_id,product_id,start_at) SELECT ${q(id)},product,now()-interval '8 days' FROM pots;
    INSERT INTO device(id,product_id,public_key) SELECT device,product,device::text FROM pots;
    INSERT INTO plant_profile(id,species_variety,context_scope) SELECT profile,profile::text,'SINTETIS' FROM pots;
    INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status)
      SELECT contribution,profile,${q(id)},'SINTETIS','test',${q(JSON.stringify(baseParams))}::jsonb ||
        -- Pots 11 (anggrek) and 17 (cabai) carry a profile validated for another pot, so neither may borrow it.
        jsonb_build_object('pot_id',CASE WHEN i IN (11,17) THEN gen_random_uuid() ELSE unit END),'approved' FROM pots;
    INSERT INTO review(contribution_id,reviewer_account_id,decision,decision_reason)
      SELECT contribution,${q(outsider.id)},'approved','SINTETIS' FROM pots;
    INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level,provenance)
      SELECT p.version,p.profile,p.contribution,1,c.proposed_parameters,'SINTETIS','{}' FROM pots p JOIN contribution c ON c.id=p.contribution;
    INSERT INTO unit(id,product_id,profile_version_id,location_label) SELECT unit,product,version,'Pot '||i FROM pots;
    INSERT INTO device_placement(device_id,unit_id,placed_by,start_at) SELECT device,unit,${q(id)},now()-interval '8 days' FROM pots;
    INSERT INTO garden_slot(id,site_id,account_id,name,unit_id)
      SELECT slot,site,${q(id)},'Zona '||i,unit FROM pots JOIN sites ON (i-1)/10=g;
    INSERT INTO plant_cycle(slot_id,account_id,species_id,plant_no,nickname,planted_on,created_at)
      SELECT slot,${q(id)},1+(i-1)%4,next_plant_no(1+(i-1)%4),'Tanaman '||i,current_date-8,now()-interval '8 days' FROM pots;
    WITH samples AS (
      SELECT p.*, n,now()-interval '2 minutes'-(335-n)*interval '30 minutes' AS at,
        CASE i WHEN 2 THEN 40 WHEN 3 THEN 85 WHEN 9 THEN CASE WHEN n>=330 THEN 65-(n-330)*0.5 ELSE 45 END
          ELSE 67-(n%48)*0.3 END AS moisture,
        -- Pot 12 carries 10 mV of ADC noise on every other reading; the projection must survive it.
        CASE WHEN i=5 THEN 3.3 WHEN i=12 THEN 3.7+(335-n)*0.2/96+CASE WHEN n%2=0 THEN 0.01 ELSE 0 END
          WHEN i=13 THEN 3.6+n*0.001 ELSE 3.85 END AS volts,
        CASE WHEN (i=7 AND n=335) OR (i=15 AND n=0) THEN 'error' ELSE 'ok' END AS status
      FROM pots p CROSS JOIN generate_series(0,335) n
      -- Pot 5 has one recovered 3 h gap; pot 10 has three in the week (weak Wi-Fi where it stands).
      WHERE i<>29 AND NOT ((i=4 AND n>330) OR (i=5 AND n BETWEEN 64 AND 68) OR (i=6 AND n BETWEEN 326 AND 330)
        OR (i=10 AND (n BETWEEN 100 AND 104 OR n BETWEEN 200 AND 204 OR n BETWEEN 300 AND 304))
        OR (i IN (8,14) AND n<CASE i WHEN 8 THEN 306 ELSE 325 END) OR (i=15 AND n BETWEEN 1 AND 306)
        OR (i=12 AND n<239))
    ), added AS (
      INSERT INTO telemetry_packet(device_id,unit_id,boot_id,sequence,clock_status,measured_at,received_at,payload,payload_sha256,signature)
      SELECT device,unit,boot,n,'synced',at,at+interval '1 second',
        jsonb_build_object('domain','smart-agro.telemetry.v2','unit_id',unit,'device_id',device,'sequence',n,'measured_at',at,
          'sensors',jsonb_build_object('moisture',jsonb_build_object('status',status,'value',CASE WHEN status='ok' THEN moisture END),
            'soil_temperature',jsonb_build_object('status','ok','value',25),'soil_ph',jsonb_build_object('status','not_measured','value',NULL)),
          'battery',jsonb_build_object('status','ok','value',volts))::text,'SINTETIS','SINTETIS' FROM samples
      RETURNING id,device_id,unit_id,sequence,measured_at,received_at,payload)
    INSERT INTO measurement(packet_id,device_id,unit_id,device_boot_seq_sensor,source,sensor_id,quality_status,value_nullable,measured_at,received_at)
      SELECT a.id,a.device_id,a.unit_id,a.id||'-'||s.key,'device',s.key,s.value->>'status',(s.value->>'value')::numeric,a.measured_at,a.received_at
      FROM added a CROSS JOIN LATERAL jsonb_each(a.payload::jsonb->'sensors') s;
    ANALYZE telemetry_packet; ANALYZE measurement; ANALYZE device_placement;
    SELECT json_agg(p ORDER BY i) FROM pots p; COMMIT;`))
  const water = (i, args={}) => rpc('my_watering_outlook',token,{p_unit_id:rows[i-1].unit,...args})
  const health = i => rpc('my_unit_health',token,{p_unit_id:rows[i-1].unit})
  // SINTETIS. One synced moisture reading for a fixture pot.
  const addReading = (row, at, value, calibration) => sql(`WITH added AS (INSERT INTO telemetry_packet(device_id,unit_id,boot_id,sequence,clock_status,measured_at,received_at,payload,payload_sha256,signature)
      VALUES(${q(row.device)},${q(row.unit)},gen_random_uuid(),1,'synced',${q(at)},${q(at)},
        ${q(JSON.stringify({calibration,sensors:{moisture:{status:'ok',value}}}))},'SINTETIS','SINTETIS') RETURNING id)
    INSERT INTO measurement(packet_id,device_id,unit_id,device_boot_seq_sensor,source,sensor_id,quality_status,value_nullable,measured_at,received_at)
    SELECT id,${q(row.device)},${q(row.unit)},id||'-moisture','device','moisture','ok',${value},${q(at)},${q(at)} FROM added`)

  await t.test('one private snapshot matches pot thresholds, tags, outlook and current device issues', async () => {
    const snapshot = await overview()
    assert.equal(snapshot.ok,true,JSON.stringify(snapshot))
    assert.equal(snapshot.plants.length,30)
    assert.equal(snapshot.devices.total,30)
    const plant = i => snapshot.plants.find(p=>p.slot_id===rows[i-1].slot)
    const tags = ['CB','BM','AB','PN']
    for(const [i,row] of rows.entries()){
      const p=plant(i+1)
      assert.equal(p.unit_id,row.unit)
      assert.equal(p.name,'Tanaman '+(i+1))
      assert.equal(p.place,'Kebun '+Math.floor(i/10))
      assert.match(p.tag,new RegExp('^'+tags[i%4]+'-[1-9][0-9]*$'))
    }
    assert.deepEqual(plant(1).band,[40,85])
    assert.equal(plant(1).state,'ok')
    assert.deepEqual(plant(1).outlook,(await water(1)).outlook)
    assert.equal(plant(2).state,'below')
    assert.equal(sql(`SELECT bad_at IS NOT NULL FROM care_alert_signals(${q(rows[1].unit)},${q(rows[1].device)},now()-interval '8 days',40) WHERE kind='soil_dry'`),'t','email and overview agree at the lower limit')
    assert.equal(plant(3).state,'above')
    assert.equal(plant(11).state,'learning')
    assert.equal(plant(11).band,null)
    assert.equal(plant(11).band_source,null)
    // A curated species learns its own pot too while no profile is validated for that pot.
    assert.equal(plant(17).species_id,1)
    assert.equal(plant(17).state,'learning')
    assert.equal(plant(17).band,null)
    assert.equal(plant(17).band_source,null)
    assert.equal(plant(1).band_source,'profile')
    assert.equal(plant(1).outlook.band_source,'profile')
    assert.equal(plant(4).moisture,null)
    assert.equal(plant(4).state,'no_reading')
    assert.equal(plant(7).state,'no_reading','sensor error')
    const kinds=i=>snapshot.devices.issues.filter(x=>x.unit_id===rows[i-1].unit).map(x=>x.kind).sort()
    assert.deepEqual(kinds(4),['silent'])
    assert.deepEqual(kinds(29),[],'before the first upload the probe has no lost connection to report')
    assert.equal(plant(29).state,'no_reading')
    const unused=rows[28]
    assert.equal(sql(`SELECT bad_at IS NULL FROM care_alert_signals(${q(unused.unit)},${q(unused.device)},now()-interval '7 days',40) WHERE kind='device_silent'`),'t')
    // One recovered gap is device history, not a Ringkasan issue. Three in seven days are.
    assert.deepEqual(kinds(5),['battery_low'])
    assert.deepEqual(kinds(10),['gap'])
    const flaky=snapshot.devices.issues.find(x=>x.unit_id===rows[9].unit)
    assert.equal(flaky.detail.count,3)
    assert.ok(Date.parse(flaky.detail.last_resumed_at)>Date.parse(flaky.since))
    assert.ok(snapshot.devices.issues.every(x=>Date.parse(x.since)>0 && x.detail))
    assert.deepEqual(await rpc('my_overview',outsider.token),{ok:true,plants:[],devices:{total:0,issues:[]}})
  })

  await t.test('a changed calibration cannot become a watering suggestion',async()=>{
    const pot=rows[19], at=ago(1), stamp=ago(1.5)
    addReading(pot,at,96,{moisture_at:stamp,ph_at:null})
    const result=await rpc('my_unlogged_rises',token,{p_unit_id:pot.unit})
    assert.equal(result.ok,true)
    assert.deepEqual(result.rises,[])
    assert.equal((await water(20)).outlook.state,'waiting')
  })

  await t.test('thirty connected plants fit the 300 ms overview budget over HTTP', async () => {
    const times=[]
    for(let i=0;i<21;i++){
      const start=performance.now()
      const result=await overview()
      const elapsed=performance.now()-start
      assert.equal(result.plants.length,30)
      if(i>0) times.push(elapsed)
    }
    times.sort((a,b)=>a-b)
    const median=(times[9]+times[10])/2,p95=times[18]
    t.diagnostic(`my_overview HTTP, 30 plants, 20 requests: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`)
    assert.ok(p95<300,`p95 ${p95.toFixed(1)} ms exceeds 300 ms`)
  })

  await t.test('waiting survives gaps, sensor failure, young data, recent watering and rises', async () => {
    for(const i of [4,6,7,8,9,15]) {
      const w=(await water(i)).outlook
      assert.equal(w.state,'waiting','fixture '+i)
      assert.equal(w.from,null)
      assert.equal(w.rate_per_hour,null)
    }
    const afterRise=rows[8]
    const lastAt=ago(0.5)
    sql(`WITH added AS (INSERT INTO telemetry_packet(device_id,unit_id,boot_id,sequence,clock_status,measured_at,received_at,payload,payload_sha256,signature)
      VALUES(${q(afterRise.device)},${q(afterRise.unit)},gen_random_uuid(),1,'synced',${q(lastAt)},${q(lastAt)},
        '{"sensors":{"moisture":{"status":"ok","value":62}}}','SINTETIS','SINTETIS') RETURNING id)
      INSERT INTO measurement(packet_id,device_id,unit_id,device_boot_seq_sensor,source,sensor_id,quality_status,value_nullable,measured_at,received_at)
      SELECT id,${q(afterRise.device)},${q(afterRise.unit)},id||'-moisture','device','moisture','ok',62,${q(lastAt)},${q(lastAt)} FROM added`)
    const daytime=Intl.supportedValuesOf('timeZone').find(z=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:z}).format(new Date())==='13')
    assert.equal((await water(9,{p_timezone:daytime})).outlook.state,'window','six falling readings after a rise')
    // SINTETIS. A flat step (sensor noise) after the falls must not switch the window off for half an hour.
    addReading(afterRise,ago(0.2),62)
    assert.equal((await water(9,{p_timezone:daytime})).outlook.state,'window','a flat step keeps the window')
    // SINTETIS. A fresh reading under the band is "below" even before 24 hours of history.
    addReading(rows[7],ago(0.5),35)
    assert.equal((await water(8)).outlook.state,'below','young data under the band')
    const threshold=(await water(2)).outlook
    assert.equal(threshold.state,'below')
    assert.ok(Date.now()-Date.parse(threshold.since)>6*86400000,'since includes consecutive threshold readings')
    const watering={p_unit_id:rows[0].unit,p_request_id:randomUUID(),p_kind:'watering',p_observed_at:ago(18),p_amount_ml:120,p_notes:''}
    assert.equal((await rpc('append_my_care_journal',token,watering)).ok,true)
    assert.equal((await water(1)).outlook.state,'waiting')
    const check={...watering,p_unit_id:rows[10].unit,p_request_id:randomUUID(),p_kind:'inspection',p_amount_ml:null,p_observed_at:ago(901),p_notes:'sehat'}
    assert.equal((await rpc('append_my_care_journal',token,check)).ok,true)
    // Fase 5 thresholds: one healthy visit is not a pattern yet (7 days, 3 visits, 2 measured waterings).
    assert.equal((await water(11)).outlook.band,null,'one visit')
    for(const [kind,minutes,notes,ml] of [['inspection',1500,'biasa',null],['inspection',2500,'bermasalah',null],['watering',2000,'',150],['watering',3000,'',150]])
      assert.equal((await rpc('append_my_care_journal',token,{...check,p_request_id:randomUUID(),p_kind:kind,p_observed_at:ago(minutes),p_notes:notes,p_amount_ml:ml})).ok,true)
    assert.equal((await water(11)).outlook.band,null,'readings span 167.5 h, under seven days')
    addReading(rows[10],ago(7*24*60+60),60)  // SINTETIS. One older reading completes the seven days.
    const learned=(await water(11)).outlook.band
    assert.ok(learned && learned[1]>learned[0])
    assert.deepEqual((await overview()).plants.find(p=>p.unit_id===rows[10].unit).band,learned)
    assert.equal((await water(11)).outlook.band_source,'own_pattern')
    // Pot 17 (cabai) gets the same visits over the same readings: the same pattern, labelled as the pot's own.
    for(const [kind,minutes,notes,ml] of [['inspection',901,'[sehat] Kondisi sehat',null],['inspection',1500,'biasa',null],['inspection',2500,'bermasalah',null],['watering',2000,'',150],['watering',3000,'',150]])
      assert.equal((await rpc('append_my_care_journal',token,{...check,p_unit_id:rows[16].unit,p_request_id:randomUUID(),p_kind:kind,p_observed_at:ago(minutes),p_notes:notes,p_amount_ml:ml})).ok,true)
    addReading(rows[16],ago(7*24*60+60),60)  // SINTETIS. Seven days, as for pot 11.
    const cabai=(await water(17)).outlook
    assert.deepEqual(cabai.band,learned,'a cabai pot without its own profile learns its own pattern')
    assert.equal(cabai.band_source,'own_pattern')
    const listed=(await overview()).plants.find(p=>p.unit_id===rows[16].unit)
    assert.deepEqual(listed.band,learned)
    assert.equal(listed.band_source,'own_pattern')
    // A new plant in the same slot starts a new cycle: the old pattern is not carried over.
    const restart=await rpc('switch_my_plant',token,{p_request_id:randomUUID(),p_slot_id:rows[16].slot,p_species_id:1,p_on:new Date().toISOString().slice(0,10),p_outcome:'berhasil',p_nickname:'Cabai baru'})
    assert.equal(restart.ok,true,JSON.stringify(restart))
    const fresh=(await water(17)).outlook
    assert.equal(fresh.band,null,'a new cycle learns again')
    assert.equal(fresh.band_source,null)
    // The latest two readings are lower than the range following that healthy visit.
    const prefs={p_email_enabled:true,p_kinds:['soil_dry']}
    await rpc('set_my_alert_preferences',token,prefs)
    try {
      const jobs=await rpc('evaluate_alerts',config.service)
      const flagged=jobs.some(j=>j.account_id===id && j.unit_name==='Pot 11' && j.kind==='soil_dry')
      assert.equal(flagged,true)
    } finally {await rpc('set_my_alert_preferences',token,{...prefs,p_email_enabled:false})}
  })
  await t.test('battery projection and upload gaps use measured volts and server receipts',async()=>{
    const h=await health(12)
    assert.equal(h.battery.length,97)
    assert.equal(h.battery_days_left,3)
    assert.equal((await health(13)).battery_days_left,null,'charging')
    assert.equal((await health(14)).battery_days_left,null,'only eleven readings')
    const gaps=(await health(5)).upload_gaps
    assert.ok(gaps.some(g=>!g.ongoing && Date.parse(g.to)-Date.parse(g.from)===3*3600000))
    assert.ok((await health(4)).upload_gaps.some(g=>g.ongoing))
  })
  await t.test('a slot can release and reassign an owned unit; other accounts cannot use it',async()=>{
    const [a,b]=rows
    const assign=(who,slot,unit)=>rpc('set_my_slot_unit',who,{p_slot_id:slot,p_unit_id:unit})
    assert.equal((await assign(outsider.token,a.slot,a.unit)).code,'unit_unavailable')
    assert.equal((await assign(outsider.token,a.slot,null)).code,'slot_unavailable')
    assert.equal((await assign(token,b.slot,a.unit)).code,'unit_already_assigned')
    assert.equal((await assign(token,a.slot,null)).ok,true)
    const freed=(await overview()).plants.find(p=>p.slot_id===a.slot)
    assert.equal(freed.state,'no_device'); assert.equal(freed.unit_id,null); assert.equal(freed.outlook,null)
    assert.equal((await assign(token,b.slot,a.unit)).ok,true)
    assert.equal((await overview()).plants.find(p=>p.slot_id===b.slot).unit_id,a.unit)
    const ended=await rpc('switch_my_plant',token,{p_request_id:randomUUID(),p_slot_id:b.slot,p_species_id:4,p_on:new Date().toISOString().slice(0,10),p_outcome:'berhasil',p_nickname:'Baru'})
    assert.equal(ended.ok,true)
    const final=await overview()
    assert.equal(final.plants.length,30)
    assert.equal(final.plants.find(p=>p.slot_id===b.slot).name,'Baru')
  })
})
