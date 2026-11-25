import { solarInput } from '../../lib/landingNarrative.ts'

/** The states the landing device moves through, in story order. */
export type DeviceMode = 'studio' | 'label' | 'tembus' | 'tanah' | 'angka'
export type LabelId = 'panel' | 'led' | 'probe' | 'esp32' | 'baterai'
/** Device parts the numbers section lights up. */
export type Highlight = 'led' | 'probe' | 'moisture' | 'solar'

/** Minutes between sensor readings (shared by the device label and the numbers section). */
export const READING_INTERVAL_MIN = 30

/** Facts only from project docs: hardware in docs/sistem-kerja-tim.md, energy from landingNarrative's solarInput. */
export const LABELS: Record<LabelId, { title: string; note: string; side: 1 | -1 }> = {
  panel: { title: 'Panel surya', note: 'mengisi baterai', side: 1 },
  led: { title: 'LED baca', note: `tiap ${READING_INTERVAL_MIN} menit`, side: -1 },
  probe: { title: 'Probe zona akar', note: 'kelembapan · suhu · pH', side: 1 },
  esp32: { title: 'ESP32', note: 'mengirim data', side: -1 },
  baterai: { title: 'Baterai', note: `target desain ${solarInput.autonomyDays} hari`, side: -1 },
}

/** Parts are named once, in the product section. The soil and numbers scenes show what the parts do instead, with
 * their own animation (roots drawing in, the LED's pulse, data up the probe, light onto the panel), not the names again. */
export function labelsFor(mode: DeviceMode): LabelId[] {
  switch (mode) {
    case 'label': return ['panel', 'led', 'probe']
    case 'tembus': return ['panel', 'led', 'probe', 'esp32', 'baterai']
    default: return []
  }
}

const aria: Record<DeviceMode, string> = {
  studio: 'Perangkat Smart Agro berdiri di atas dua probe baja dan berputar perlahan',
  label: 'Perangkat Smart Agro dengan penanda panel surya, LED baca, dan probe zona akar',
  tembus: 'Cangkang perangkat dibuat tembus pandang, memperlihatkan papan ESP32 dan baterai di dalamnya',
  tanah: 'Perangkat Smart Agro tertancap di tanah, probe membaca zona akar',
  angka: 'Perangkat Smart Agro di tanah, bagiannya disorot sesuai angka yang dibaca',
}
export const ariaFor = (mode: DeviceMode) => aria[mode]
