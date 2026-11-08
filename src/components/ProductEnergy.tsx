import {useEffect,useRef,useState} from 'react'
import type {ProductAccountClient} from '../lib/productAccountClient'
import {parseEnergyWorkspace,type EnergyWorkspace} from '../lib/productEnergyClient'
const empty:EnergyWorkspace={roles:[],meters:[],windows:[]}
const utc=(v:string)=>new Date(v).toLocaleString('id-ID',{timeZone:'UTC'})+' UTC'
const reason:Record<string,string>={credited:'Dikreditkan',policy_disabled:'Program belum aktif',below_threshold:'Di bawah ambang poin',daily_cap:'Batas poin harian tercapai'}
export default function ProductEnergy({client,onSessionExpired}:{client:ProductAccountClient;onSessionExpired:()=>void}){
 const [workspace,setWorkspace]=useState(empty),[pending,setPending]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState(false)
 const [device,setDevice]=useState(''),[key,setKey]=useState(''),[calibration,setCalibration]=useState(''),[load,setLoad]=useState(''),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[power,setPower]=useState(''),[meter,setMeter]=useState(''),[revokeReason,setRevokeReason]=useState('')
 const generation=useRef(0),expired=useRef(onSessionExpired);expired.current=onSessionExpired
 function failure(err:unknown,request:number){if(generation.current!==request)return;setError(true);setMessage(err instanceof Error?err.message:'Operasi energi gagal.');if(!client.session){setWorkspace(empty);expired.current()}}
 async function run(action:()=>Promise<void>){const request=++generation.current;setPending(true);setMessage('');setError(false);try{await action();const next=parseEnergyWorkspace(await client.rpc('energy_workspace'));if(generation.current===request)setWorkspace(next)}catch(err){failure(err,request)}finally{if(generation.current===request)setPending(false)}}
 useEffect(()=>{const counter=generation,request=++counter.current;client.rpc('energy_workspace').then(v=>{const next=parseEnergyWorkspace(v);if(counter.current===request)setWorkspace(next)}).catch(e=>failure(e,request)).finally(()=>{if(counter.current===request)setPending(false)});return()=>{counter.current++}
 // Client remains stable for this signed-in panel; session callbacks use the latest ref.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[client])
 const operator=workspace.roles.includes('operator')
 return <section className="panel miro-card" aria-labelledby="energy-heading" style={{overflowWrap:'anywhere'}}><header className="panel-heading"><h3 id="energy-heading">Bukti energi meter</h3></header><div className="miro-card-body" aria-busy={pending}>
  <p>Riwayat dari meter bertanda tangan, terpisah dari simulasi. Operator mencatat bukti kalibrasi dan beban layak; tanda tangan membuktikan asal paket, bukan akurasi fisik meter.</p>
  {message&&<p role={error?'alert':'status'}>{message}</p>}{pending&&<p role="status">Memuat energi…</p>}
  <button className="button" disabled={pending} onClick={()=>void run(async()=>{})}>Muat ulang energi</button>
  <h4>Meter terdaftar</h4><ul className="miro-list">{workspace.meters.map(m=><li key={m.id}><div><strong>Meter {m.id}</strong><small>Perangkat {m.device_id} · {m.status}</small><p>Kalibrasi: {m.calibration_ref}</p><p>Beban layak: {m.eligible_load_ref}</p><small>{utc(m.valid_from)} – {utc(m.valid_until)} · batas {m.max_power_w} W</small>{m.revoked_reason&&<p>Alasan pencabutan: {m.revoked_reason}</p>}</div></li>)}</ul>{!workspace.meters.length&&!pending&&<p>Belum ada meter yang dapat ditampilkan.</p>}
  <h4>Riwayat energi milik saya</h4><p>Maksimal 100 periode terbaru. Energi layak = nilai terkecil dari panen surya dan beban; SOC baterai tidak dihitung sebagai panen baru.</p>
  <ul className="miro-list">{workspace.windows.map(w=><li key={w.id}><div><strong>{utc(w.start_at)} – {utc(w.end_at)}</strong><small>Perangkat {w.device_id}</small><p>Panen {w.solar_harvest_wh} Wh · Beban {w.load_wh} Wh · Layak {Math.min(w.solar_harvest_wh,w.load_wh)} Wh</p><p>SOC {w.battery_soc_pct===null?'tidak diukur':w.battery_soc_pct+'%'} · Kredit {w.credited_points} poin · {reason[w.reward_reason??'']??'Belum diproses'}</p><small>Diterima {utc(w.received_at)} · asal tanda tangan diterima; kalibrasi berdasarkan atestasi operator</small></div></li>)}</ul>{!workspace.windows.length&&!pending&&<p>Belum ada periode meter untuk akun ini.</p>}
  {operator&&<details><summary>Pengaturan meter oleh operator</summary>
   <form onSubmit={e=>{e.preventDefault();void run(async()=>{const publicKey=key.trim();if(!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)||btoa(atob(publicKey))!==publicKey||atob(publicKey).length!==32)throw new Error('Kunci publik harus base64 kanonis Ed25519 32 byte.');await client.rpc('operator_register_energy_meter',{p_device_id:device.trim(),p_public_key:publicKey,p_calibration_ref:calibration.trim(),p_eligible_load_ref:load.trim(),p_valid_from:new Date(from).toISOString(),p_valid_until:new Date(until).toISOString(),p_max_power_w:Number(power)});setKey('');setMessage('Registrasi meter tersimpan; ini bukan verifikasi fisik otomatis.')})}}><fieldset className="product-account-form" disabled={pending}><legend>Daftarkan meter berkalibrasi</legend>
    <label className="miro-field"><span>UUID perangkat untuk meter</span><input required pattern="[0-9a-fA-F-]{36}" maxLength={36} value={device} onChange={e=>setDevice(e.target.value)}/></label>
    <label className="miro-field"><span>Kunci publik meter Ed25519 (base64)</span><input required maxLength={44} value={key} onChange={e=>setKey(e.target.value)}/></label>
    <label className="miro-field"><span>Referensi bukti kalibrasi meter</span><textarea aria-label="Referensi bukti kalibrasi meter" required maxLength={1000} value={calibration} onChange={e=>setCalibration(e.target.value)}/></label>
    <label className="miro-field"><span>Referensi verifikasi beban layak</span><textarea aria-label="Referensi verifikasi beban layak" required maxLength={1000} value={load} onChange={e=>setLoad(e.target.value)}/></label>
    <p>Waktu formulir mengikuti zona waktu browser. Masa berlaku maksimal satu tahun; riwayat menggunakan UTC.</p><div className="miro-form-two">
     <label className="miro-field"><span>Mulai berlaku meter</span><input type="datetime-local" required value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="miro-field"><span>Akhir berlaku meter</span><input type="datetime-local" required value={until} onChange={e=>setUntil(e.target.value)}/></label></div>
    <label className="miro-field"><span>Batas daya meter (W)</span><input type="number" required min="0.001" max="100000" step="any" value={power} onChange={e=>setPower(e.target.value)}/></label><button className="button" type="submit">Daftarkan meter</button>
   </fieldset></form>
   <form onSubmit={e=>{e.preventDefault();void run(async()=>{await client.rpc('operator_revoke_energy_meter',{p_meter_id:meter,p_reason:revokeReason.trim()});setMeter('');setRevokeReason('');setMessage('Meter dicabut; bukti lama tetap tersimpan.')})}}><fieldset className="product-account-form" disabled={pending}><legend>Cabut registrasi meter</legend>
    <label className="miro-field"><span id="energy-revoke-label">Meter untuk dicabut</span><select required aria-labelledby="energy-revoke-label" value={meter} onChange={e=>setMeter(e.target.value)}><option value="">Pilih meter aktif</option>{workspace.meters.filter(m=>m.status==='active').map(m=><option key={m.id} value={m.id}>{m.device_id} · {m.id}</option>)}</select></label><label className="miro-field"><span>Alasan pencabutan meter</span><textarea aria-label="Alasan pencabutan meter" required maxLength={1000} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)}/></label><button className="button" type="submit">Cabut meter</button>
   </fieldset></form>
  </details>}
 </div></section>
}
