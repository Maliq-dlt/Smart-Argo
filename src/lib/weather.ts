/** Weather for the pot stage: a snapshot model, a simulated source for the demo, an adapter for the Open-Meteo response and
 * the one-line note it may add to the advice. Pure and dependency-free, so the same file runs in the browser, in tests and in
 * the (dormant) `weather-forecast` edge function. */

export type Condition = 'cerah' | 'berawan' | 'mendung' | 'hujan' | 'badai'
/** What the demo control offers; `terik` is a clear sky that is also hot. */
export type SimWeather = 'cerah' | 'berawan' | 'mendung' | 'hujan' | 'terik'
export type Placement = 'indoor' | 'outdoor' | 'rooftop'

export interface ForecastHour { inHours: number; condition: Condition; rainMm: number; tempC: number }
export interface WeatherSnapshot {
  /** ISO local time of the reading; empty for a simulated snapshot. */
  at: string
  condition: Condition
  tempC: number
  humidity: number
  cloud: number
  windMs: number
  rainMm: number
  forecast: ForecastHour[]
}

/** Air temperature from which a clear sky counts as terik and the media should be checked more often. */
const HOT_C = 33
/** Rain below this in an hour is a drizzle that does not change the watering. */
const RAIN_MM = 1

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown, fallback: number) => typeof x === 'number' && Number.isFinite(x) ? x : fallback

/** WMO weather interpretation code to a condition. Anything outside the table (snow, which the tropics do not have, or a
 * value the provider adds later) is read as cloudy rather than failing a whole forecast. */
export function conditionFromWmo(code: unknown): Condition {
  if (typeof code !== 'number') return 'berawan'
  if (code === 0 || code === 1) return 'cerah'
  if (code === 2) return 'berawan'
  if (code === 3 || code === 45 || code === 48) return 'mendung'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'hujan'
  if (code >= 95 && code <= 99) return 'badai'
  return 'berawan'
}

/** The stage draws five skies: a thunderstorm is its rain, and a hot clear sky is its terik. */
export function simKind(w: WeatherSnapshot): SimWeather {
  if (w.condition === 'hujan' || w.condition === 'badai') return 'hujan'
  if (w.condition === 'cerah' && w.tempC >= HOT_C) return 'terik'
  return w.condition
}

const hours = (n: number, make: (inHours: number) => Omit<ForecastHour, 'inHours'>): ForecastHour[] => Array.from({ length: n }, (_, i) => ({ inHours: i + 1, ...make(i + 1) }))
const STEADY = (condition: Condition, tempC: number) => hours(6, () => ({ condition, rainMm: 0, tempC }))
const SIMULATED: Record<SimWeather, WeatherSnapshot> = {
  cerah: { at: '', condition: 'cerah', tempC: 29, humidity: 60, cloud: 10, windMs: 2, rainMm: 0, forecast: STEADY('cerah', 29) },
  berawan: { at: '', condition: 'berawan', tempC: 28, humidity: 70, cloud: 55, windMs: 3, rainMm: 0, forecast: STEADY('berawan', 28) },
  mendung: { at: '', condition: 'mendung', tempC: 26, humidity: 82, cloud: 90, windMs: 3.5, rainMm: 0, forecast: STEADY('mendung', 26) },
  hujan: { at: '', condition: 'hujan', tempC: 24, humidity: 94, cloud: 100, windMs: 5, rainMm: 4, forecast: hours(6, h => h <= 3 ? { condition: 'hujan', rainMm: 3, tempC: 24 } : { condition: 'mendung', rainMm: 0, tempC: 25 }) },
  terik: { at: '', condition: 'cerah', tempC: 36, humidity: 45, cloud: 5, windMs: 1.5, rainMm: 0, forecast: STEADY('cerah', 36) },
}
/** The weather of the demo, chosen by the visitor. A copy, so a caller cannot change the table. */
export const simulatedWeather = (kind: SimWeather): WeatherSnapshot => structuredClone(SIMULATED[kind])

/** The current conditions and the next six hours from an Open-Meteo `/v1/forecast` response asked for `current`
 * (temperature_2m, relative_humidity_2m, precipitation, weather_code, cloud_cover, wind_speed_10m in m/s) and `hourly`
 * (temperature_2m, precipitation, weather_code). A response that cannot be read at all throws; missing optional parts
 * only shorten the snapshot. */
export function fromOpenMeteo(json: unknown): WeatherSnapshot {
  if (!isRecord(json) || !isRecord(json.current) || typeof json.current.temperature_2m !== 'number' || !Number.isFinite(json.current.temperature_2m)) throw new Error('Respons cuaca tidak dapat dibaca.')
  const cur = json.current
  const at = typeof cur.time === 'string' ? cur.time : ''
  const tempC = cur.temperature_2m as number
  const hourly = isRecord(json.hourly) ? json.hourly : null
  const times = hourly && Array.isArray(hourly.time) ? hourly.time : []
  const column = (key: string) => hourly && Array.isArray(hourly[key]) ? hourly[key] as unknown[] : []
  const [temps, rain, codes] = [column('temperature_2m'), column('precipitation'), column('weather_code')]
  // Hours are local ISO strings ("2026-11-15T14:00"), so the current hour is the entry that starts with the same date and hour.
  const now = at ? times.findIndex(t => typeof t === 'string' && t.slice(0, 13) === at.slice(0, 13)) : -1
  const forecast: ForecastHour[] = []
  for (let inHours = 1; now >= 0 && inHours <= 6 && now + inHours < times.length; inHours++) {
    const i = now + inHours
    forecast.push({ inHours, condition: conditionFromWmo(codes[i]), rainMm: num(rain[i], 0), tempC: num(temps[i], tempC) })
  }
  return { at, condition: conditionFromWmo(cur.weather_code), tempC, humidity: num(cur.relative_humidity_2m, 0), cloud: num(cur.cloud_cover, 0), windMs: num(cur.wind_speed_10m, 0), rainMm: num(cur.precipitation, 0), forecast }
}

/** One line of context for the advice, or nothing. Indoors the weather changes nothing; outdoors it can only say two things,
 * both about timing and inspection and never about an amount, and it quotes only hours that are in the forecast. */
export function weatherNote(w: WeatherSnapshot, placement: Placement): string | null {
  if (placement === 'indoor') return null
  if (w.condition === 'hujan' || w.condition === 'badai') return 'Sedang hujan: pertimbangkan menunda siram.'
  const coming = w.forecast.find(f => f.rainMm >= RAIN_MM)
  if (coming) return `Hujan sekitar ${coming.inHours} jam lagi: pertimbangkan menunda siram.`
  if (w.tempC >= HOT_C) return 'Suhu tinggi: periksa media lebih sering.'
  return null
}
