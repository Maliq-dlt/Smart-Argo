import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { parseEnergyPacket } from '../src/lib/energyTelemetry.ts'
import { createEnergyIngestHandler } from '../supabase/functions/energy-ingest/handler.ts'
const packet=()=>({domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:randomUUID(),device_id:randomUUID(),boot_id:randomUUID(),sequence:0,start_at:'2026-11-06T00:00:00Z',end_at:'2026-11-06T00:15:00Z',clock_status:'synced',solar_start_wh:10,solar_end_wh:12.5,load_start_wh:5,load_end_wh:6.5,battery_soc_pct:null})
test('Energy contract rejects invented trust, noncanonical periods, invalid counters and missing data',()=>{
 assert.equal(parseEnergyPacket(packet()).battery_soc_pct,null)
 for(const change of [{source:'simulation'},{verified:true},{points:100},{sequence:0.5},{sequence:2147483648},{meter_id:'fake'},{clock_status:'unsynced'},{start_at:'2026-11-06T00:00:01Z'},{start_at:'2026-11-06T07:00:00+07:00'},{end_at:'2026-11-06T00:30:00Z'},{end_at:'2026-02-30T00:15:00Z'},{solar_end_wh:9},{load_start_wh:-1},{solar_start_wh:NaN},{load_end_wh:Infinity},{battery_soc_pct:101},{battery_soc_pct:undefined}])assert.throws(()=>parseEnergyPacket({...packet(),...change}))
 const missing:Record<string,unknown>=packet();delete missing.battery_soc_pct;assert.throws(()=>parseEnergyPacket(missing))
})
test('Energy handler rejects malformed/oversized envelopes and denied origins before database access',async()=>{
 const handle=createEnergyIngestHandler({url:'http://127.0.0.1:1',serviceKey:'test-only',appOrigin:'http://localhost:5173'})
 const request=(body:string,headers:Record<string,string>={})=>new Request('http://localhost/functions/v1/energy-ingest',{method:'POST',headers:{'content-type':'application/json',...headers},body})
 assert.equal((await handle(request('{}',{'origin':'https://untrusted.test'}))).status,403)
 assert.equal((await handle(new Request('http://localhost'))).status,405)
 assert.equal((await handle(request('{}',{'content-type':'text/plain'}))).status,415)
 assert.equal((await handle(request('x'.repeat(12289)))).status,413)
 assert.equal((await handle(request(JSON.stringify({payload:JSON.stringify({...packet(),source:'simulation'}),signature:'x'.repeat(88)})))).status,400)
 assert.equal((await handle(request('null'))).status,400)
})

test('Energy history response rejects hidden/missing identity, impossible windows and forged credit',async()=>{
 const {parseEnergyWorkspace}=await import('../src/lib/productEnergyClient.ts')
 const row={id:randomUUID(),device_id:randomUUID(),meter_id:randomUUID(),start_at:'2026-11-06T00:00:00Z',end_at:'2026-11-06T00:15:00Z',received_at:'2026-11-06T00:15:01Z',solar_harvest_wh:20,load_wh:15,battery_soc_pct:null,evidence_quality:'verified_meter',credited_points:0,reward_reason:'policy_disabled'}
 assert.equal(parseEnergyWorkspace({ok:true,roles:['owner'],meters:[],windows:[row]}).windows[0].credited_points,0)
 for(const change of [{id:'fake'},{meter_id:null},{end_at:'2026-11-06T00:30:00Z'},{solar_harvest_wh:NaN},{load_wh:-1},{battery_soc_pct:101},{credited_points:1.1},{evidence_quality:'simulated'},{reward_reason:'invented'}])assert.throws(()=>parseEnergyWorkspace({ok:true,roles:['owner'],meters:[],windows:[{...row,...change}]}))
 assert.throws(()=>parseEnergyWorkspace({ok:true,roles:['superadmin'],meters:[],windows:[]}))
})
