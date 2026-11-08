export interface EnergyMeter {id:string;device_id:string;status:'active'|'revoked';calibration_ref:string;eligible_load_ref:string;valid_from:string;valid_until:string;max_power_w:number;created_at:string;revoked_reason:string|null}
export interface StoredEnergy {id:string;device_id:string;meter_id:string;start_at:string;end_at:string;received_at:string;solar_harvest_wh:number;load_wh:number;battery_soc_pct:number|null;evidence_quality:'verified_meter';credited_points:number;reward_reason:'credited'|'policy_disabled'|'below_threshold'|'daily_cap'|null}
export interface EnergyWorkspace {roles:string[];meters:EnergyMeter[];windows:StoredEnergy[]}
const id=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const date=(v:unknown)=>typeof v==='string'&&v.length<=64&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const number=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
function rows(v:unknown):Record<string,unknown>[]{if(!Array.isArray(v)||v.length>100||v.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new Error('Respons energi tidak valid.');return v}
export function parseEnergyWorkspace(value:unknown):EnergyWorkspace{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Respons energi tidak valid.')
 const v=value as Record<string,unknown>
 if(v.ok!==true||!Array.isArray(v.roles)||v.roles.length>4||v.roles.some(r=>!['owner','contributor','curator','operator'].includes(r)))throw new Error('Peran energi tidak valid.')
 const meters=rows(v.meters).map(m=>{if(!id(m.id)||!id(m.device_id)||!['active','revoked'].includes(String(m.status))||!text(m.calibration_ref,1000)||!text(m.eligible_load_ref,1000)||![m.valid_from,m.valid_until,m.created_at].every(date)||Date.parse(String(m.valid_until))<=Date.parse(String(m.valid_from))||!number(m.max_power_w,0.001,100000)||(m.revoked_reason!==null&&!text(m.revoked_reason,1000)))throw new Error('Data registrasi meter tidak valid.');return m as unknown as EnergyMeter})
 const windows=rows(v.windows).map(w=>{if(![w.id,w.device_id,w.meter_id].every(id)||![w.start_at,w.end_at,w.received_at].every(date)||Date.parse(String(w.start_at))%900000!==0||Date.parse(String(w.end_at))-Date.parse(String(w.start_at))!==900000||!number(w.solar_harvest_wh,0,25000)||!number(w.load_wh,0,25000)||(w.battery_soc_pct!==null&&!number(w.battery_soc_pct,0,100))||w.evidence_quality!=='verified_meter'||!Number.isSafeInteger(w.credited_points)||Number(w.credited_points)<0||(w.reward_reason!==null&&!['credited','policy_disabled','below_threshold','daily_cap'].includes(String(w.reward_reason))))throw new Error('Riwayat energi tidak valid.');return w as unknown as StoredEnergy})
 return {roles:v.roles,meters,windows}
}
