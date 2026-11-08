export interface EnergyPacket {
 domain:'smart-agro.energy.v1';schema_version:1;source:'meter';meter_id:string;device_id:string;boot_id:string;sequence:number
 start_at:string;end_at:string;clock_status:'synced';solar_start_wh:number;solar_end_wh:number;load_start_wh:number;load_end_wh:number;battery_soc_pct:number|null
}
export function parseEnergyPacket(value:unknown):EnergyPacket{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Paket energi harus objek.')
 const v=value as Record<string,unknown>,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
 const fields=['domain','schema_version','source','meter_id','device_id','boot_id','sequence','start_at','end_at','clock_status','solar_start_wh','solar_end_wh','load_start_wh','load_end_wh','battery_soc_pct']
 if(Object.keys(v).length!==fields.length||fields.some(k=>!(k in v))||v.domain!=='smart-agro.energy.v1'||v.schema_version!==1||v.source!=='meter'||v.clock_status!=='synced'||!['meter_id','device_id','boot_id'].every(k=>typeof v[k]==='string'&&uuid.test(v[k] as string))||!Number.isInteger(v.sequence)||Number(v.sequence)<0||Number(v.sequence)>2147483647)throw new Error('Identitas, sumber, jam atau urutan energi tidak valid.')
 for(const k of ['start_at','end_at'])if(typeof v[k]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(v[k] as string)||!Number.isFinite(Date.parse(v[k] as string))||new Date(v[k] as string).toISOString().slice(0,19)!==(v[k] as string).slice(0,19))throw new Error('Periode energi harus UTC yang valid.')
 const start=Date.parse(v.start_at as string),end=Date.parse(v.end_at as string)
 if(start%900000!==0||end-start!==900000)throw new Error('Periode energi harus tepat 15 menit pada batas UTC.')
 for(const k of ['solar_start_wh','solar_end_wh','load_start_wh','load_end_wh'])if(typeof v[k]!=='number'||!Number.isFinite(v[k])||v[k]<0||v[k]>1e9)throw new Error('Counter Wh harus angka hingga 0–1 miliar.')
 if(Number(v.solar_end_wh)<Number(v.solar_start_wh)||Number(v.load_end_wh)<Number(v.load_start_wh)||(v.battery_soc_pct!==null&&(typeof v.battery_soc_pct!=='number'||!Number.isFinite(v.battery_soc_pct)||v.battery_soc_pct<0||v.battery_soc_pct>100)))throw new Error('Counter atau SOC tidak valid.')
 return v as unknown as EnergyPacket
}
