export interface Profile {
  pot_id: string; crop: string; media: string; phase: string
  validated: boolean; ph_validated: boolean
  needs_water: number[]; drained: number[]; next_visit_h: number
  hot_c: number; ph_range: [number, number]
}
export interface Sample { t_h: number; moisture: number; temp_c: number; ph: number | null; valid: boolean }
export interface Watering { t_h: number; volume_ml: number }
export interface PotCase {
  profile: Profile; samples: Sample[]; now_h: number
  watering?: Watering | null; media_changed?: boolean; name?: string; expected?: string
}
export interface Evidence {
  pot_id: string; crop: string; low: number; wet: number; moisture: number; temp_c: number
  eta_h: number | null; slope_per_h: number | null; r2: number | null
  watering_response: string; ph_status: string
}
export const RULES = [
  ['KALIBRASI_LOKAL', 'Acuan lokal', 'Profil disahkan; media tetap'],
  ['PULIHKAN_DATA', 'Mutu data', 'Valid dan berumur ≤5 menit'],
  ['PERIKSA_SENSOR', 'Lonjakan pembacaan', 'Perubahan ≤20 poin / 2 menit, atau ada siraman'],
  ['PERIKSA_SIRAMAN', 'Respons siraman', 'Evaluasi menit ke-30–60; kenaikan ≥5 poin'],
  ['PERIKSA_DRAINASE', 'Basah menetap', 'Batas basah tidak menetap selama 3 jam'],
  ['PERIKSA_MEDIA_KERING', 'Kering terkonfirmasi', 'Tiga bacaan dalam 1 jam di bawah acuan'],
  ['PERIKSA_PANAS', 'Paparan panas', 'Suhu dibandingkan dengan acuan profil'],
  ['UKUR_ULANG_PH', 'Pemeriksaan pH', 'Tiga bacaan baru di sisi luar rentang yang sama'],
  ['PERIKSA_SEBELUM_PERGI', 'Tren sebelum kunjungan', '≥6 sampel, ≥2,5 jam, R² ≥0,8, proyeksi ≤12 jam'],
  ['AMATI', 'Pengamatan', 'Tidak ada pemicu terkonfirmasi'],
] as const
export type DecisionCode = typeof RULES[number][0]
export interface Decision { decision: DecisionCode; action: string; reason: string; evidence: Evidence }

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const round = (n: number, places: number) => Number(n.toFixed(places))
function number(value: unknown, name: string, low: number, high: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
    throw new Error(`${name} harus angka hingga dalam rentang ${low}..${high}`)
}
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} harus objek`)
}
function boolean(value: unknown, name: string) {
  if (typeof value !== 'boolean') throw new Error(`${name} harus boolean`)
}

/** Validate the same JSON contract as simulasi_pot.py, including imported files. */
export function parseCase(input: unknown): PotCase {
  object(input, 'kasus'); object(input.profile, 'profile')
  const p = input.profile
  number(input.now_h, 'now_h', 0, 1e9)
  if (input.media_changed !== undefined) boolean(input.media_changed, 'media_changed')
  for (const name of ['validated', 'ph_validated']) boolean(p[name], name)
  for (const name of ['pot_id', 'crop', 'media', 'phase']) {
    const value = p[name]
    if (typeof value !== 'string' || !value.trim() || value.length > 120)
      throw new Error(`${name} harus teks tidak kosong, maksimum 120 karakter`)
  }
  for (const name of ['needs_water', 'drained']) {
    const values = p[name]
    if (!Array.isArray(values) || values.length < 3 || values.length > 100)
      throw new Error(`${name} perlu 3..100 observasi acuan`)
    for (const v of values) number(v, name, 0, 100)
  }
  if (median(p.drained as number[]) - median(p.needs_water as number[]) < 10)
    throw new Error('Dua kelompok acuan belum terpisah sekurangnya 10 poin')
  number(p.next_visit_h, 'next_visit_h', .1, 24)
  number(p.hot_c, 'hot_c', 20, 60)
  if (!Array.isArray(p.ph_range) || p.ph_range.length !== 2) throw new Error('ph_range memerlukan dua batas')
  p.ph_range.forEach(v => number(v, 'ph_range', 0, 14))
  if (p.ph_range[0] >= p.ph_range[1]) throw new Error('Batas pH harus berurutan')
  if (!Array.isArray(input.samples) || input.samples.length < 1 || input.samples.length > 10000)
    throw new Error('samples harus daftar berisi 1..10000 rekaman')
  let previous = -1
  for (const row of input.samples) {
    object(row, 'sampel')
    number(row.t_h, 't_h', 0, input.now_h)
    number(row.moisture, 'moisture', 0, 100)
    number(row.temp_c, 'temp_c', -20, 60)
    if (row.ph !== null) number(row.ph, 'ph', 0, 14)
    boolean(row.valid, 'valid')
    if (row.t_h <= previous) throw new Error('Waktu sampel harus naik dan tidak duplikat')
    previous = row.t_h
  }
  if (input.watering != null) {
    object(input.watering, 'watering')
    number(input.watering.t_h, 'watering.t_h', 0, input.now_h)
    number(input.watering.volume_ml, 'watering.volume_ml', .1, 5000)
  }
  return input as unknown as PotCase
}

export function evaluate(input: unknown): Decision {
  const c = parseCase(input)
  const { profile: p, samples: rows, now_h: now, watering: water } = c
  const low = median(p.needs_water), wet = Math.min(100, median(p.drained) + 10)
  const recent = rows.filter(r => now - r.t_h <= 6), last = rows.at(-1)!
  const facts: Evidence = { pot_id: p.pot_id, crop: p.crop, low, wet, moisture: last.moisture,
    temp_c: last.temp_c, eta_h: null, slope_per_h: null, r2: null,
    watering_response: 'Belum dievaluasi', ph_status: 'Belum ada pH tervalidasi yang mutakhir' }
  const result = (decision: DecisionCode, action: string, reason: string): Decision => ({ decision, action, reason, evidence: facts })

  if (!p.validated || c.media_changed)
    return result('KALIBRASI_LOKAL', 'Tetapkan kembali acuan pot', 'Profil belum disahkan atau media berubah; saran penyiraman ditahan.')
  if (!last.valid || now - last.t_h > 5 / 60)
    return result('PULIHKAN_DATA', 'Periksa sensor dan sambungan', 'Data terakhir tidak valid atau lebih tua dari lima menit.')
  const prev = rows.at(-2)
  if (prev && last.t_h - prev.t_h <= 2 / 60 && Math.abs(last.moisture - prev.moisture) > 20 &&
    (!water || water.t_h < prev.t_h || water.t_h > last.t_h))
    return result('PERIKSA_SENSOR', 'Periksa posisi probe dan ulangi pembacaan', 'Lonjakan lebih dari 20 poin dalam dua menit tanpa catatan penyiraman.')

  const phRows = rows.filter(r => r.valid && r.ph !== null && now - r.t_h <= 24)
  let phProblem = false
  if (p.ph_validated && phRows.length) {
    const phLast = phRows.at(-1)!
    facts.ph_status = `pH terakhir ${phLast.ph}; umur ${round(now - phLast.t_h, 2)} jam`
    const tail = phRows.slice(-3)
    phProblem = tail.length === 3 && (tail.every(r => r.ph! < p.ph_range[0]) || tail.every(r => r.ph! > p.ph_range[1]))
    if (phProblem) facts.ph_status += '; tiga pembacaan di sisi luar rentang yang sama; perlu ukur ulang dengan acuan'
  }
  if (water) {
    const before = rows.filter(r => r.valid && water.t_h - r.t_h >= 0 && water.t_h - r.t_h <= 1)
    const after = rows.filter(r => r.valid && r.t_h - water.t_h >= 10 / 60 && r.t_h - water.t_h <= .75)
    if (before.length && after.length) {
      const delta = median(after.map(r => r.moisture)) - before.at(-1)!.moisture
      facts.watering_response = `Perubahan ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} poin setelah ${water.volume_ml} mL; hanya lokasi probe`
      if (now - water.t_h >= .5 && now - water.t_h <= 1 && delta < 5 && last.moisture < low)
        return result('PERIKSA_SIRAMAN', 'Periksa aliran air dan kontak probe sebelum menambah air', 'Respons lokal kurang dari lima poin; air belum tentu mencapai probe atau pembacaannya bermasalah.')
    }
  }
  const wetRows = recent.filter(r => now - r.t_h <= 3.01)
  const noGaps = (items: Sample[]) => items.every((r, i) => !i || r.t_h - items[i - 1].t_h <= 1)
  if (wetRows.length >= 4 && wetRows.at(-1)!.t_h - wetRows[0].t_h >= 3 &&
    wetRows.every(r => r.valid && r.moisture >= wet) && noGaps(wetRows))
    return result('PERIKSA_DRAINASE', 'Periksa media, lubang pot dan genangan tatakan', 'Bacaan berada di atas batas basah lokal selama tiga jam; ini petunjuk pemeriksaan, bukan diagnosis akar.')
  const tail = recent.slice(-3)
  if (tail.length === 3 && tail.every(r => r.valid && r.moisture < low && now - r.t_h <= 1))
    return result('PERIKSA_MEDIA_KERING', 'Konfirmasi media kering, lalu siram bertahap dan catat volume', 'Tiga sampel mutakhir berada di bawah acuan kebutuhan air pot ini.')
  if (last.temp_c >= p.hot_c)
    return result('PERIKSA_PANAS', 'Periksa paparan panas dan kondisi tanaman', 'Suhu melewati batas demonstrasi profil; suhu tinggi sendiri bukan perintah menambah air.')
  if (phProblem)
    return result('UKUR_ULANG_PH', 'Ukur ulang pH dengan metode acuan sebelum mengubah media', 'Tiga pembacaan pH di luar rentang profil; sistem tidak menentukan dosis pupuk atau dolomit.')

  // ponytail: regresi lokal maksimum 12 jam; model baru perlu siklus lapangan berlabel.
  const trend = recent.filter(r => !water || r.t_h > water.t_h)
  if (trend.length >= 6 && trend.at(-1)!.t_h - trend[0].t_h >= 2.5 && trend.every(r => r.valid) && noGaps(trend)) {
    const avgX = trend.reduce((s, r) => s + r.t_h, 0) / trend.length
    const avgY = trend.reduce((s, r) => s + r.moisture, 0) / trend.length
    const slope = trend.reduce((s, r) => s + (r.t_h - avgX) * (r.moisture - avgY), 0) /
      trend.reduce((s, r) => s + (r.t_h - avgX) ** 2, 0)
    const intercept = avgY - slope * avgX
    const total = trend.reduce((s, r) => s + (r.moisture - avgY) ** 2, 0)
    const r2 = total ? 1 - trend.reduce((s, r) => s + (r.moisture - (slope * r.t_h + intercept)) ** 2, 0) / total : 0
    facts.slope_per_h = round(slope, 3); facts.r2 = round(r2, 3)
    if (slope < -1 && r2 >= .8 && last.moisture > low) {
      const eta = (last.moisture - low) / -slope
      if (eta <= 12) {
        facts.eta_h = round(eta, 2)
        if (eta <= p.next_visit_h)
          return result('PERIKSA_SEBELUM_PERGI', 'Jadwalkan pemeriksaan sebelum kunjungan berikutnya', `Jika laju kering bertahan, acuan terlewati sekitar ${eta.toFixed(1)} jam; bukan waktu siram pasti.`)
      }
    }
  }
  return result('AMATI', 'Lanjutkan pengamatan sesuai jadwal', 'Belum ada kondisi terkonfirmasi yang membutuhkan tindakan; ketiadaan peringatan bukan jaminan tanaman sehat.')
}

export function phaseAt(day: number, onion: boolean) {
  if (day === 0) return 'Awal tanam'
  if (onion) return day <= 25 ? 'Vegetatif' : day <= 50 ? 'Pembentukan umbi' : 'Pematangan umbi'
  return day <= 30 ? 'Vegetatif' : day <= 55 ? 'Berbunga' : 'Berbuah'
}

/** Appending is explicit: sliders never rewrite recorded observations. */
export function addSample(c: PotCase, reading: Omit<Sample, 't_h'>, minutes = 30): PotCase {
  number(minutes, 'selang menit', .1, 1440)
  const now = round(c.now_h + minutes / 60, 6)
  return parseCase({ ...c, now_h: now, samples: [...c.samples, { ...reading, t_h: now }] })
}

export function recordWatering(c: PotCase, volume: number): PotCase {
  // Recording a human action must not invent a measured moisture response.
  return parseCase({ ...c, watering: { t_h: c.now_h, volume_ml: volume } })
}
