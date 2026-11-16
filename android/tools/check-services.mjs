// Read-only smoke against configured services. Never creates users, reservations or telemetry.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
const config=Object.fromEntries((await readFile(new URL('local.properties',root),'utf8')).split(/\r?\n/).filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const at=line.indexOf('=');return [line.slice(0,at).trim(),line.slice(at+1).trim().replaceAll('\\:',':')]}));
const endpoint=config.SUPABASE_URL?.replace(/\/$/,'');
assert.equal(new URL(endpoint).protocol,'https:');
assert.ok(config.SUPABASE_ANON_KEY&&!config.SUPABASE_ANON_KEY.startsWith('sb_secret_'));
const results=[];
async function check(name,action){try{await action();results.push({name,status:'passed'})}catch(error){results.push({name,status:'failed',error:error.message});process.exitCode=1}}
async function request(path,{body,token,method=body?'POST':'GET'}={}){
 const response=await fetch(endpoint+path,{method,headers:{apikey:config.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 return {status:response.status,data:response.status===204?{}:await response.json()};
}
await check('Auth public settings',async()=>{const r=await request('/auth/v1/settings');assert.equal(r.status,200);assert.equal(typeof r.data.external?.email,'boolean')});
for(const rpc of ['my_products','my_units','my_unit_overview','reward_workspace','my_chain_proofs']) await check(`${rpc}: rejects anonymous access`,async()=>{
 const r=await request(`/rest/v1/rpc/${rpc}`,{body:{}});
 assert.ok(r.status===401||r.status===403||r.data.ok===false&&['unauthorized','invalid_session'].includes(r.data.code));
 assert.notEqual(r.status,404);
});
await check('Open-Meteo city search and forecast',async()=>{
 const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?name=Bandung&count=6&language=id&format=json',{signal:AbortSignal.timeout(20000)});assert.ok(response.ok);
 const city=(await response.json()).results.find(city=>city.country_code==='ID');assert.ok(city);
 const forecast=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m,shortwave_radiation&timeformat=unixtime&timezone=UTC`,{signal:AbortSignal.timeout(20000)});assert.ok(forecast.ok);
 const weather=await forecast.json();assert.equal(weather.current_units.shortwave_radiation,'W/m²');assert.equal(weather.current_units.temperature_2m,'°C');assert.equal(weather.current_units.time,'unixtime');
 assert.ok(Number.isFinite(weather.current.shortwave_radiation)&&weather.current.shortwave_radiation>=0);assert.ok(Math.abs(weather.current.time-Date.now()/1000)<7200);
});
let token=process.env.SMART_AGRO_TEST_TOKEN;
let temporary=false;
if(!token&&process.env.SMART_AGRO_TEST_EMAIL&&process.env.SMART_AGRO_TEST_PASSWORD) await check('Test account login',async()=>{
 const r=await request('/auth/v1/token?grant_type=password',{body:{email:process.env.SMART_AGRO_TEST_EMAIL,password:process.env.SMART_AGRO_TEST_PASSWORD}});
 assert.equal(r.status,200);assert.equal(typeof r.data.access_token,'string');token=r.data.access_token;temporary=true;
});
if(token) {
 try{
  await check('Account session',async()=>assert.equal((await request('/auth/v1/user',{token})).status,200));
  for(const rpc of ['my_products','my_units','my_unit_overview','reward_workspace','my_chain_proofs']) await check(`${rpc}: account read`,async()=>{
   const r=await request(`/rest/v1/rpc/${rpc}`,{body:{},token});assert.equal(r.status,200);assert.notEqual(r.data.ok,false);
   if(rpc==='reward_workspace'){assert.equal(r.data.ok,true);assert.equal(r.data.balance.confirmed_points-r.data.balance.reserved_points,r.data.balance.available_points);assert.ok(Array.isArray(r.data.catalog))}
   if(rpc==='my_chain_proofs') assert.ok(Array.isArray(r.data.proofs));
  });
 }finally{if(temporary) await check('Close smoke session',async()=>assert.equal((await request('/auth/v1/logout?scope=local',{body:{},token})).status,204))}
} else results.push({name:'Live account flows',status:'skipped',reason:'No test-account credentials or session supplied. No account data was written.'});
const folder=new URL('../.tmp/services/',root);await mkdir(folder,{recursive:true});
await writeFile(new URL('report.json',folder),JSON.stringify({at:new Date().toISOString(),kind:'read-only live service smoke',results},null,2)+'\n');
for(const item of results) console.log(`${item.status}: ${item.name}`);
console.log(`Report: ${fileURLToPath(new URL('report.json',folder))}`);
