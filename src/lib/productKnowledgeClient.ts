import { parseCase, type Profile } from './agronomyEngine'
export interface KnowledgeProfile { id:string; species_variety:string; context_scope:string }
export interface Revision { revision:number; source_method_license:string; evidence_ref:string; proposed_parameters:Record<string,unknown>; created_at:string }
export interface Review { decision:'approved'|'needs_revision'|'rejected'; decision_reason:string; revision:number|null; reviewed_at?:string }
export interface Contribution { id:string; profile_id:string; author_account_id:string; source_method_license:string; evidence_ref:string; proposed_parameters:Record<string,unknown>; status:'pending_review'|'needs_revision'|'approved'|'rejected'; revision_count:number; latest_review:Review|null; revisions:Revision[]; reviews:Review[] }
export interface KnowledgeWorkspace { roles:string[]; profiles:KnowledgeProfile[]; contributions:Contribution[] }
export interface PublishedDetails { id:string; profile_id:string; species_variety:string; context_scope:string; version:number; parameters_and_scope:Record<string,unknown>; evidence_level:string; source_method_license:string; evidence_ref:string; published_at:string; provenance_status:'pinned'|'legacy_unpinned' }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v)
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Respons pengetahuan tidak valid.');return v as Record<string,unknown>}
function list(v:unknown,max:number):unknown[]{if(!Array.isArray(v)||v.length>max)throw new Error('Daftar pengetahuan tidak valid.');return v}
const integer=(v:unknown,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=max
const date=(v:unknown)=>typeof v==='string'&&v.length<=64&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
function review(input:unknown):Review {const v=obj(input);if(!['approved','needs_revision','rejected'].includes(String(v.decision))||!text(v.decision_reason,1000)||(v.revision!==null&&!integer(v.revision,20))||(v.reviewed_at!==undefined&&!date(v.reviewed_at)))throw new Error('Riwayat tinjauan tidak valid.');return v as unknown as Review}
export function parseKnowledgeWorkspace(input:unknown):KnowledgeWorkspace{
 const v=obj(input),roles=list(v.roles,4);if(!roles.every(r=>['owner','contributor','curator','operator'].includes(String(r))))throw new Error('Peran akun tidak valid.')
 const profiles=list(v.profiles,100).map(item=>{const p=obj(item);if(!id(p.id)||!text(p.species_variety,120)||!text(p.context_scope,1000))throw new Error('Profil tidak valid.');return p as unknown as KnowledgeProfile})
 const contributions=list(v.contributions,100).map(item=>{const c=obj(item);if(!id(c.id)||!id(c.profile_id)||!id(c.author_account_id)||!text(c.source_method_license,1000)||!text(c.evidence_ref,1000)||!['pending_review','needs_revision','approved','rejected'].includes(String(c.status))||!integer(c.revision_count,20))throw new Error('Kontribusi tidak valid.');obj(c.proposed_parameters)
  const revisions=list(c.revisions,20).map(item=>{const r=obj(item);if(!integer(r.revision,20)||!text(r.source_method_license,1000)||!text(r.evidence_ref,1000)||!date(r.created_at))throw new Error('Revisi tidak valid.');obj(r.proposed_parameters);return r as unknown as Revision})
  return {...c,revisions,reviews:list(c.reviews,20).map(review),latest_review:c.latest_review===null?null:review(c.latest_review)} as unknown as Contribution
 })
 return {roles:roles as string[],profiles,contributions}
}
export function parsePublishedDetails(input:unknown):PublishedDetails{
 const p=obj(input);if(!['pinned','legacy_unpinned'].includes(String(p.provenance_status))||!id(p.id)||!id(p.profile_id)||!text(p.species_variety,120)||!text(p.context_scope,1000)||!integer(p.version,2147483647)||!text(p.evidence_level,240)||!text(p.source_method_license,1000)||!text(p.evidence_ref,1000)||!date(p.published_at))throw new Error('Detail profil terbit tidak valid.');obj(p.parameters_and_scope);return p as unknown as PublishedDetails
}
export function parseSubmittedProfile(raw:string):Profile{
 if(raw.length>16000)throw new Error('JSON profil terlalu besar.')
 const value:unknown=JSON.parse(raw),p=obj(value)
 const keys=['pot_id','crop','media','phase','validated','ph_validated','needs_water','drained','next_visit_h','hot_c','ph_range']
 if(Object.keys(p).length!==keys.length||keys.some(k=>!(k in p)))throw new Error('JSON harus berisi tepat sebelas bidang Profile.')
 return parseCase({profile:p,now_h:0,samples:[{t_h:0,moisture:50,temp_c:25,ph:null,valid:true}]}).profile
}
