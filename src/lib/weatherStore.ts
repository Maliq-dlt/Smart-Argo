import { isSimWeather, type SimWeather } from './weather.ts'

/** The demo weather the visitor picked, kept in this browser only. */
export const WEATHER_KEY = 'smart-agro.weather'

export function readSimWeather(): SimWeather {
  try { const stored = localStorage.getItem(WEATHER_KEY); return isSimWeather(stored) ? stored : 'cerah' } catch { return 'cerah' }
}
export function saveSimWeather(kind: SimWeather) {
  try { localStorage.setItem(WEATHER_KEY, kind) } catch { /* private window or blocked storage: the choice just is not remembered */ }
}
