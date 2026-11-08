import { evaluate, parseCase, type DecisionCode, type Profile } from './agronomyEngine.ts'
import { parseTelemetryV2, type TelemetryPacketV2 } from './telemetry.ts'

type Packet = TelemetryPacketV2 & { packet_id: string; received_at: string }
export interface ExplanationContext {
  ok: true; unit_id: string; device_id: string; ownership_id: string; profile_version_id: string
  device_status: string; registry_status: string; evaluated_at: string
  profile: { parameters: unknown; species_variety: string; evidence_level: string; provenance_status: string } | null
  packets: Packet[]
}
export interface DeviceExplanation {
  decision: DecisionCode | 'DATA_BELUM_ADA' | 'PROFIL_BELUM_LAYAK'
  action: string; reason: string; mascot_state: 'bingung_menunggu' | 'tenang_senang' | 'sedih_perhatian' | 'waspada_marah'
  explanation: string; source_mode: 'rule_fallback'; rule_version: 'agronomy-v1.telemetry-v1'; ai_status: 'not_configured'
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
export function parseExplanationContext(value: unknown): ExplanationContext {
  if (!record(value) || value.ok!==true || !['unit_id','device_id','ownership_id','profile_version_id'].every(k=>typeof value[k]==='string' && uuid.test(value[k] as string)) || typeof value.evaluated_at!=='string' || !Number.isFinite(Date.parse(value.evaluated_at)) || !Array.isArray(value.packets) || value.packets.length>120 || !['active','revoked','offline'].includes(String(value.device_status)) || !['active','revoked','pending'].includes(String(value.registry_status))) throw new Error('Invalid evidence context')
  if (value.profile!==null && (!record(value.profile) || typeof value.profile.species_variety!=='string' || typeof value.profile.evidence_level!=='string')) throw new Error('Invalid profile evidence')
  const packets = value.packets.map(raw=>{
    if (!record(raw) || typeof raw.packet_id!=='string' || !uuid.test(raw.packet_id) || typeof raw.received_at!=='string' || !Number.isFinite(Date.parse(raw.received_at))) throw new Error('Invalid packet evidence')
    return { ...parseTelemetryV2({ ...raw, device_id:value.device_id, unit_id:value.unit_id, domain:'smart-agro.telemetry.v2', schema_version:2, source:'device' }), packet_id:raw.packet_id, received_at:raw.received_at }
  }).sort((a,b)=>Date.parse(a.measured_at)-Date.parse(b.measured_at) || Date.parse(a.received_at)-Date.parse(b.received_at) || a.packet_id.localeCompare(b.packet_id))
  return { ...value, packets } as unknown as ExplanationContext
}

/** Uses recorded device values only. Missing values never become synthetic samples. */
export function explainDeviceEvidence(context: ExplanationContext, question = ''): DeviceExplanation {
  const now=Date.parse(context.evaluated_at), last=context.packets.at(-1)
  const result = (decision: DeviceExplanation['decision'], action: string, reason: string, mascot_state: DeviceExplanation['mascot_state']='bingung_menunggu'): DeviceExplanation => ({
    decision,action,reason,mascot_state,source_mode:'rule_fallback',rule_version:'agronomy-v1.telemetry-v1',ai_status:'not_configured',
    explanation:`${action}. ${reason} ${last?.sensors.soil_ph.status!=='ok' ? 'pH terakhir tidak tersedia sebagai angka valid; tidak diganti nol atau nilai lama. ' : ''}${question.trim() ? 'Pertanyaan dicatat sebagai konteks; jawaban ini dibatasi bukti sensor dan aturan. ' : ''}Penjelasan aturan; layanan AI generatif belum dikonfigurasi. Bukan diagnosis kesehatan tanaman atau perintah aktuator.`,
  })
  if (!last) return result('DATA_BELUM_ADA','Tunggu bacaan perangkat','Belum ada paket perangkat pada periode kepemilikan ini dalam 24 jam terakhir.')
  if (context.device_status!=='active' || context.registry_status!=='active') return result('PULIHKAN_DATA','Periksa status perangkat','Perangkat atau registri tidak aktif; rekomendasi ditahan.')
  if (last.clock_status!=='synced' || Date.parse(last.measured_at)>now) return result('PULIHKAN_DATA','Periksa sinkronisasi jam','Jam belum tersinkron atau pengukuran berada di masa depan; kondisi saat ini belum dapat dinilai.')
  if (now-Date.parse(last.measured_at)>300000) return result('PULIHKAN_DATA','Periksa sensor dan sambungan','Data terakhir lebih tua dari lima menit; paket tersimpan ini bukan kondisi saat ini.')
  if (last.sensors.moisture.status!=='ok' || last.sensors.soil_temperature.status!=='ok') return result('PULIHKAN_DATA','Pulihkan sensor yang belum layak','Kelembapan atau suhu terakhir error/tidak diukur; angka pengganti tidak dibuat.')
  if (context.profile?.provenance_status!=='pinned') return result('PROFIL_BELUM_LAYAK','Periksa sumber profil','Profil lama belum mempunyai salinan sumber yang tetap; rekomendasi ditahan.')
  const profile=context.profile?.parameters
  if (!record(profile)) return result('PROFIL_BELUM_LAYAK','Periksa profil unit','Profil terbit tidak memuat parameter aturan yang dapat digunakan.')
  if (profile.pot_id!==context.unit_id || profile.validated!==true) return result('KALIBRASI_LOKAL','Tetapkan acuan lokal unit','Profil belum disahkan untuk ID unit ini; acuan pot lain tidak dipindahkan sebagai kalibrasi.')
  // Stop at an invalid packet or device boot boundary; do not bridge gaps with invented readings.
  const valid: Packet[]=[]
  for (const packet of [...context.packets].reverse()) {
    if (packet.boot_id!==last.boot_id || packet.clock_status!=='synced' || Date.parse(packet.measured_at)>now || packet.sensors.moisture.status!=='ok' || packet.sensors.soil_temperature.status!=='ok') break
    if (!valid.some(p=>p.measured_at===packet.measured_at)) valid.unshift(packet)
  }
  try {
    const input=parseCase({ profile:profile as unknown as Profile,now_h:now/3600000,samples:valid.map(p=>({
      t_h:Date.parse(p.measured_at)/3600000,moisture:p.sensors.moisture.value!,temp_c:p.sensors.soil_temperature.value!,
      ph:p.sensors.soil_ph.status==='ok' ? p.sensors.soil_ph.value : null,valid:true,
    })) })
    // A currently unavailable pH cannot be inferred from an older number.
    if (last.sensors.soil_ph.status!=='ok') input.profile={...input.profile,ph_validated:false}
    const decision=evaluate(input)
    const mascot = ['KALIBRASI_LOKAL','PULIHKAN_DATA','PERIKSA_SENSOR'].includes(decision.decision) ? 'bingung_menunggu' : decision.decision==='AMATI' ? 'tenang_senang' : ['PERIKSA_MEDIA_KERING','PERIKSA_SIRAMAN','PERIKSA_SEBELUM_PERGI'].includes(decision.decision) ? 'sedih_perhatian' : 'waspada_marah'
    return result(decision.decision,decision.action,decision.reason,mascot)
  } catch { return result('PROFIL_BELUM_LAYAK','Periksa profil dan bukti','Parameter profil atau rangkaian sampel tidak memenuhi kontrak mesin aturan.') }
}

export interface ExplanationSnapshot { id:string;created_at:string;context_sha256:string;profile_version_id:string;decision_payload:DeviceExplanation;evidence_ref:ExplanationContext & {question:string} }
export function parseExplanationSnapshot(value:unknown):ExplanationSnapshot {
  if(!record(value)||typeof value.id!=='string'||!uuid.test(value.id)||typeof value.created_at!=='string'||!Number.isFinite(Date.parse(value.created_at))||typeof value.context_sha256!=='string'||!/^([0-9a-f]{64})$/.test(value.context_sha256)||typeof value.profile_version_id!=='string'||!uuid.test(value.profile_version_id)||!record(value.decision_payload))throw new Error('Penjelasan tersimpan tidak valid.')
  const d=value.decision_payload
  if(!['DATA_BELUM_ADA','PROFIL_BELUM_LAYAK','KALIBRASI_LOKAL','PULIHKAN_DATA','PERIKSA_SENSOR','PERIKSA_SIRAMAN','PERIKSA_DRAINASE','PERIKSA_MEDIA_KERING','PERIKSA_PANAS','UKUR_ULANG_PH','PERIKSA_SEBELUM_PERGI','AMATI'].includes(String(d.decision))||!['bingung_menunggu','tenang_senang','sedih_perhatian','waspada_marah'].includes(String(d.mascot_state))||d.source_mode!=='rule_fallback'||d.rule_version!=='agronomy-v1.telemetry-v1'||d.ai_status!=='not_configured'||!['action','reason','explanation'].every(k=>typeof d[k]==='string'&&(d[k] as string).length>0&&(d[k] as string).length<=8000))throw new Error('Hasil penjelasan tidak valid.')
  const context=parseExplanationContext(value.evidence_ref)
  if(!record(value.evidence_ref)||typeof value.evidence_ref.question!=='string'||value.evidence_ref.question.length>500)throw new Error('Konteks pertanyaan tidak valid.')
  if(value.profile_version_id!==context.profile_version_id)throw new Error('Versi bukti penjelasan tidak sesuai.')
  return {...value,evidence_ref:{...context,question:value.evidence_ref.question}} as unknown as ExplanationSnapshot
}
