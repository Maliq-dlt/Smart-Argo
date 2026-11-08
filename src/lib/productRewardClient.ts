export interface RewardPolicy { id:string;version:string;wh_per_point:number;daily_point_cap:number }
export interface RewardCatalogItem { id:string;title:string;point_cost:number;stock_total:number;stock_reserved:number;availability:'available'|'out_of_stock'|'disabled' }
export interface RewardRedemption { id:string;catalog_item_id:string;title:string;reserved_points:number;status:'reserved'|'fulfilled'|'cancelled'|'compensated';created_at:string;fulfillment_reference:string|null;compensation_reason:string|null;account_id?:string }
export interface RewardLedger { id:string;signed_points:number;note:string;created_at:string;reversal_of:string|null;redemption_id:string|null;reward_event_id:string|null }
export interface RewardWorkspace { roles:string[];policy:RewardPolicy|null;balance:{confirmed_points:number;reserved_points:number;available_points:number};catalog:RewardCatalogItem[];redemptions:RewardRedemption[];ledger:RewardLedger[];fulfillment_queue:RewardRedemption[] }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v)
const nullableId=(v:unknown)=>v===null||id(v)
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max
const date=(v:unknown)=>typeof v==='string'&&v.length<=64&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Respons reward tidak valid.');return v as Record<string,unknown>}
function list(v:unknown,max:number):unknown[]{if(!Array.isArray(v)||v.length>max)throw new Error('Daftar reward tidak valid.');return v}
function redemption(input:unknown,operator=false):RewardRedemption{const r=obj(input);if(!id(r.id)||!id(r.catalog_item_id)||!text(r.title,120)||!integer(r.reserved_points,1,100000)||!['reserved','fulfilled','cancelled','compensated'].includes(String(r.status))||!date(r.created_at)||(r.fulfillment_reference!==null&&!text(r.fulfillment_reference,240))||(r.compensation_reason!==null&&!text(r.compensation_reason,1000))||(operator&&!id(r.account_id)))throw new Error('Penukaran reward tidak valid.');return r as unknown as RewardRedemption}
export function parseRewardWorkspace(input:unknown):RewardWorkspace{
 const w=obj(input);if(w.ok!==true)throw new Error('Respons reward gagal.');const roles=list(w.roles,4);if(!roles.every(r=>['owner','contributor','curator','operator'].includes(String(r))))throw new Error('Peran akun tidak valid.')
 let policy:RewardPolicy|null=null
 if(w.policy!==null){const p=obj(w.policy);if(!id(p.id)||!text(p.version,120)||typeof p.wh_per_point!=='number'||!Number.isFinite(p.wh_per_point)||p.wh_per_point<0.001||p.wh_per_point>1000000||!integer(p.daily_point_cap,1,100000))throw new Error('Kebijakan reward tidak valid.');policy=p as unknown as RewardPolicy}
 const balance=obj(w.balance);for(const key of ['confirmed_points','reserved_points','available_points'])if(!integer(balance[key],0,Number.MAX_SAFE_INTEGER))throw new Error('Saldo reward tidak valid.')
 if(Number(balance.confirmed_points)-Number(balance.reserved_points)!==balance.available_points)throw new Error('Ringkasan saldo tidak konsisten. Muat ulang.')
 const catalog=list(w.catalog,100).map(item=>{const c=obj(item);if(!id(c.id)||!text(c.title,120)||!integer(c.point_cost,1,100000)||!integer(c.stock_total,0,1000000)||!integer(c.stock_reserved,0,Number(c.stock_total))||!['available','out_of_stock','disabled'].includes(String(c.availability)))throw new Error('Katalog tidak valid.');return c as unknown as RewardCatalogItem})
 const ledger=list(w.ledger,100).map(item=>{const l=obj(item);if(!id(l.id)||!integer(l.signed_points,-100000,100000)||l.signed_points===0||!text(l.note,1000)||!date(l.created_at)||![l.reversal_of,l.redemption_id,l.reward_event_id].every(nullableId))throw new Error('Riwayat ledger tidak valid.');return l as unknown as RewardLedger})
 return{roles:roles as string[],policy,balance:balance as RewardWorkspace['balance'],catalog,ledger,redemptions:list(w.redemptions,100).map(r=>redemption(r)),fulfillment_queue:list(w.fulfillment_queue,100).map(r=>redemption(r,true))}
}
