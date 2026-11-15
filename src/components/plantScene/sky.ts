import type { SimWeather } from '../../lib/weather.ts'
import { clamp, mix, smooth } from './kit.ts'

/** Sky colours by hour: top, middle, bottom, far hills, near hills. The last row repeats the first so midnight closes the loop. */
const SKY: [number, string, string, string, string, string][] = [
  [0, '#0d1822', '#14242c', '#1d3236', '#1b2d2e', '#14231f'],
  [5.2, '#34455f', '#75718a', '#c79a8a', '#4c5a5e', '#34423d'],
  [7.5, '#8fb7cf', '#c5ddd8', '#efe9cf', '#9db7a3', '#6f9a74'],
  [12, '#86bad8', '#c6e3e1', '#eaf3de', '#a5c4a9', '#78a57c'],
  [16.5, '#8bb4cc', '#d4dfcf', '#f3e8c4', '#a0bba0', '#6f9870'],
  [18.6, '#4b5e7c', '#c58f8b', '#f2b98a', '#6a6f72', '#46544a'],
  [20.5, '#1a2738', '#243747', '#33483f', '#25363a', '#1a2924'],
  [24, '#0d1822', '#14242c', '#1d3236', '#1b2d2e', '#14231f'],
]
export function paletteAt(hour: number): string[] {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < SKY.length - 2 && h >= SKY[i + 1][0]) i++
  const a = SKY[i], b = SKY[i + 1], t = smooth(clamp((h - a[0]) / (b[0] - a[0])))
  return [1, 2, 3, 4, 5].map(k => mix(a[k] as string, b[k] as string, t))
}
/** A body along an arc across the stage (scene units); it shows for twelve hours after it rises. */
export const orbit = (hours: number) => {
  const p = clamp(hours / 12)
  return { x: 92 + p * 616, y: 262 - Math.sin(p * Math.PI) * 196, a: hours < 0 || hours > 12 ? 0 : Math.min(1, hours * 2, (12 - hours) * 2) }
}
/** 0 in daylight, 1 deep in the night, easing through dusk and dawn. */
export const nightFactor = (hour: number) => {
  const h = ((hour % 24) + 24) % 24
  return smooth(clamp((.34 - Math.sin((h - 6) / 12 * Math.PI)) / .5))
}
/** The same clock hour on the day number closest to `current`, so the scene runs on through midnight (23.9 then 0.1
 * becomes 23.9 then 24.1) instead of rewinding through noon. */
export const unwrapHour = (current: number, next: number) => next + Math.round((current - next) / 24) * 24

/** How each weather changes the sky: cloud cover (0..1, six clouds in all), how far the sky and hills dim, rain, heat and the
 * strength of the breeze. `cerah` is the stage as it was drawn before weather existed (three clouds, a bright sky). */
export interface SkyLook { cloud: number; dim: number; rain: number; heat: number; wind: number }
export const LOOKS: Record<SimWeather, SkyLook> = {
  cerah: { cloud: .5, dim: 0, rain: 0, heat: 0, wind: 1 },
  berawan: { cloud: .8, dim: .15, rain: 0, heat: 0, wind: 1.1 },
  mendung: { cloud: 1, dim: .5, rain: 0, heat: 0, wind: 1.3 },
  hujan: { cloud: 1, dim: .8, rain: 1, heat: 0, wind: 1.7 },
  terik: { cloud: .17, dim: 0, rain: 0, heat: 1, wind: .6 },
}
/** Streaks of rain drawn for a rain strength, out of `max` prepared ones. */
export const dropCount = (rain: number, max = 70) => Math.round(clamp(rain) * max)
