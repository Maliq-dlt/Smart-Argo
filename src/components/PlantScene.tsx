import { useEffect, useRef } from 'react'
import { motion } from './plantScene/kit.ts'
import type { SimWeather } from '../lib/weather.ts'
import type { SceneSpecies } from './plantScene/plants.ts'
import { Scene, type SceneReadings } from './plantScene/scene.ts'
import './plantScene/plantScene.css'

export type CareEffect = { kind: 'plant' | 'water'; id: number }
export type { SceneReadings }
interface Props {
  species: SceneSpecies; day: number; planted: boolean; moisture: number; contact: boolean
  /** Hour of the session clock (0–24); the sky follows it. */
  hour: number
  /** When given, the three readings are written beside the part they describe. */
  readings?: SceneReadings
  /** The sky over the pot; leave it out for a pot that does not see the weather. */
  weather?: SimWeather
  /** A watering shows the can once per new id; an effect that is already running when the stage mounts is not replayed. */
  careEffect?: CareEffect | null
  label: string
}

/** The pot stage: a React shell around the imperative drawing in `plantScene/`. The drawing is driven only by these props. */
export default function PlantScene({ species, day, planted, moisture, contact, hour, readings, weather, careEffect, label }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const fresh = useRef(false)
  const first = useRef(species)
  const seen = useRef(careEffect?.id ?? 0)
  const withReadings = readings !== undefined
  const busyUntil = useRef(0), rainy = useRef(false)

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { motion.reduced = mq.matches }
    sync(); mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const scene = new Scene(svg, { species: first.current, readings: withReadings })
    sceneRef.current = scene; fresh.current = true
    let raf = 0, last = 0
    // Full rate only while something really moves (a watering, new readings, the clock, rain); the slow breeze alone is
    // drawn at 30 fps, which halves the work of a stage left open on a phone (2026-11-24).
    const tick = (ms: number) => {
      if (!last || ms < busyUntil.current || rainy.current || ms - last >= 1000 / 30 - 2) {
        scene.frame(last ? Math.min(.05, (ms - last) / 1000) : 0, ms / 1000); last = ms
      }
      raf = requestAnimationFrame(tick)
    }
    const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick) } }
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }
    // The loop stops while the stage is off screen (and the browser pauses it in a hidden tab).
    const watcher = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => entry?.isIntersecting ? start() : stop())
    watcher?.observe(svg)
    start()
    return () => { stop(); watcher?.disconnect(); sceneRef.current = null; svg.replaceChildren() }
  }, [withReadings])

  // Before the state below, so a watering starts before its new moisture arrives and the plant waits for the water.
  useEffect(() => {
    if (!careEffect || careEffect.id === seen.current) return
    seen.current = careEffect.id
    if (careEffect.kind === 'water') sceneRef.current?.pour()
    busyUntil.current = performance.now() + 6000
  }, [careEffect])
  // New readings, a clock step or a weather change set springs moving: draw them at full rate until they settle.
  useEffect(() => { busyUntil.current = performance.now() + 3000 }, [species, day, planted, moisture, contact, hour, weather])
  useEffect(() => { rainy.current = weather === 'hujan' }, [weather])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.set({ species, day, planted, moisture, contact, hour, readings, weather })
    if (fresh.current) { fresh.current = false; scene.frame(0, performance.now() / 1000) }
  })

  return <div className="plant-scene">
    <svg ref={svgRef} viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice" role="img" aria-label={label} />
  </div>
}
