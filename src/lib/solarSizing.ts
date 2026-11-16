/** Solar panel and battery sizing for a device's daily load. Its own module so the landing can use it without pulling the
 * whole ecosystem engine (`miroProductEngine.ts`, which re-exports it) into the first page's bundle. */

export interface PowerModeSpec {
  name: string
  powerW: number
  hoursPerDay: number
}

export function calculateSolarBatterySizing(input: {
  modes: PowerModeSpec[]
  autonomyDays: number
  usableDepthOfDischarge: number
  batteryPathEfficiency: number
  peakSunHours: number
  solarSystemEfficiency: number
  batteryNominalVoltageV: number
  currentSocPct?: number
}) {
  if (!input.modes.length) throw new Error('Minimal satu mode beban harus diisi.')
  const totalHours = input.modes.reduce((acc, m) => acc + m.hoursPerDay, 0)
  if (Math.abs(totalHours - 24) > 1e-6) {
    throw new Error('Total durasi mode harian harus tepat 24 jam.')
  }
  for (const m of input.modes) {
    if (m.powerW < 0 || m.hoursPerDay < 0) throw new Error('Daya dan durasi mode tidak boleh negatif.')
  }
  if (
    input.autonomyDays <= 0 ||
    input.usableDepthOfDischarge <= 0 ||
    input.usableDepthOfDischarge > 1 ||
    input.batteryPathEfficiency <= 0 ||
    input.batteryPathEfficiency > 1 ||
    input.peakSunHours <= 0 ||
    input.solarSystemEfficiency <= 0 ||
    input.solarSystemEfficiency > 1 ||
    input.batteryNominalVoltageV <= 0
  ) {
    throw new Error('Parameter otonomi, efisiensi, jam matahari puncak, dan tegangan nominal harus bernilai positif valid.')
  }

  const dailyEnergyWh = input.modes.reduce((acc, m) => acc + m.powerW * m.hoursPerDay, 0)
  const minBatteryWh =
    (dailyEnergyWh * input.autonomyDays) / (input.usableDepthOfDischarge * input.batteryPathEfficiency)
  const minBatteryAh = minBatteryWh / input.batteryNominalVoltageV
  const minPanelWp = dailyEnergyWh / (input.peakSunHours * input.solarSystemEfficiency)

  const soc = input.currentSocPct ?? 85
  const powerPolicy: 'normal' | 'low_power_buffer' | 'critical_cutoff' =
    soc < 15 ? 'critical_cutoff' : soc < 35 ? 'low_power_buffer' : 'normal'

  return {
    dailyEnergyWh,
    minBatteryWh,
    minBatteryAh,
    minPanelWp,
    powerPolicy,
  }
}
