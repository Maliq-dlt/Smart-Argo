import { useEffect,useRef,useState } from 'react'
import type { ProductAccountClient } from '../lib/productAccountClient'
import { parseExplanationSnapshot,type ExplanationSnapshot } from '../lib/deviceExplanation'
const states={bingung_menunggu:'Menunggu data atau acuan yang layak',tenang_senang:'Pengamatan rutin',sedih_perhatian:'Perlu perhatian',waspada_marah:'Prioritas pemeriksaan'}
const utc=(value:string)=>new Date(value).toLocaleString('id-ID',{timeZone:'UTC'})+' UTC'
export default function ProductExplanation({client,unitId,deviceId,onSessionExpired}:{client:Pick<ProductAccountClient,'rpc'|'session'|'explain'>;unitId:string;deviceId:string;onSessionExpired:()=>void}){
 const [snapshots,setSnapshots]=useState<ExplanationSnapshot[]>([]),[question,setQuestion]=useState(''),[pending,setPending]=useState(true),[message,setMessage]=useState('')
 const generation=useRef(0),retry=useRef<{id:string;question:string}|null>(null),expired=useRef(onSessionExpired);expired.current=onSessionExpired
 useEffect(()=>{let active=true;const counter=generation,request=++counter.current;setPending(true);setSnapshots([]);setMessage('')
  client.rpc('unit_explanations',{p_unit_id:unitId,p_device_id:deviceId}).then(r=>{if(!Array.isArray(r.snapshots)||r.snapshots.length>10)throw new Error('Riwayat penjelasan tidak valid.');const next=r.snapshots.map(parseExplanationSnapshot);if(active&&generation.current===request)setSnapshots(next)}).catch(e=>{if(!active)return;setMessage(e instanceof Error?e.message:'Riwayat penjelasan gagal dimuat.');if(!client.session)expired.current()}).finally(()=>{if(active&&generation.current===request)setPending(false)})
  return()=>{active=false;counter.current++}
 },[client,unitId,deviceId])
 const latest=snapshots[0]
 return <section aria-labelledby="device-explanation-heading"><h4 id="device-explanation-heading">Penjelasan berbasis bukti</h4>
  <p>Penilaian memakai bacaan perangkat dan versi profil saat diminta. Emosi maskot adalah petunjuk antarmuka, bukan emosi biologis tanaman.</p>
  {message&&<p role="status">{message}</p>}
  <form onSubmit={e=>{e.preventDefault();const request=++generation.current;setPending(true);setMessage('');const text=question.trim();const identity=retry.current?.question===text?retry.current:{id:crypto.randomUUID(),question:text};retry.current=identity
   void client.explain(unitId,deviceId,identity.id,text).then(r=>{const next=parseExplanationSnapshot(r.snapshot);if(generation.current===request){setSnapshots(previous=>[next,...previous.filter(s=>s.id!==next.id)].slice(0,10));retry.current=null;setMessage('Penjelasan dan bukti tersimpan.')}}).catch(err=>{if(generation.current!==request)return;setMessage(err instanceof Error?err.message:'Penjelasan gagal; bacaan tersimpan tetap tersedia.');if(!client.session){setSnapshots([]);expired.current()}}).finally(()=>{if(generation.current===request)setPending(false)})
  }}><fieldset className="product-account-form" disabled={pending}><legend>Nilai kondisi dari data tersimpan</legend><label className="miro-field"><span>Pertanyaan atau konteks pengamatan (opsional)</span><input maxLength={500} value={question} onChange={e=>setQuestion(e.target.value)}/></label><button className="button" type="submit">Buat penjelasan berbasis bukti</button></fieldset></form>
  {latest&&<article className="miro-callout"><strong>{states[latest.decision_payload.mascot_state]}</strong><p>Dinilai pada {utc(latest.evidence_ref.evaluated_at)}. Hasil ini adalah rekaman penilaian, bukan pemantauan langsung.</p><p>{latest.decision_payload.explanation}</p>
   <details><summary>Lihat bukti penilaian</summary><p>Profil versi {latest.evidence_ref.profile?.species_variety??'tidak tersedia'} · {latest.profile_version_id}</p><p>Tingkat bukti: {latest.evidence_ref.profile?.evidence_level??'belum tersedia'}</p><p>Aturan: {latest.decision_payload.rule_version} · Kode: {latest.decision_payload.decision}</p><p>Pertanyaan: {latest.evidence_ref.question||'Tidak ada'}</p><p>Identitas snapshot: {latest.id}</p><p>SHA256 konteks tersimpan: {latest.context_sha256}</p><ul className="miro-list">{latest.evidence_ref.packets.map(p=><li key={p.packet_id}><div><strong>Diukur {utc(p.measured_at)}</strong><p>Diterima {utc(p.received_at)} · Jam {p.clock_status}</p><p>Kelembapan: {p.sensors.moisture.value??'NULL'} ({p.sensors.moisture.status}); suhu: {p.sensors.soil_temperature.value??'NULL'} ({p.sensors.soil_temperature.status}); pH: {p.sensors.soil_ph.value??'NULL'} ({p.sensors.soil_ph.status})</p><small>Paket {p.packet_id}</small></div></li>)}</ul></details>
  </article>}
  {snapshots.length>1&&<details><summary>Penilaian sebelumnya ({snapshots.length-1})</summary><ul className="miro-list">{snapshots.slice(1).map(s=><li key={s.id}><div><strong>{utc(s.evidence_ref.evaluated_at)} · {states[s.decision_payload.mascot_state]}</strong><p>{s.decision_payload.explanation}</p></div></li>)}</ul></details>}
 </section>
}
