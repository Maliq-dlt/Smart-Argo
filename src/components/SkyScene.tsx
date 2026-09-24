import { useEffect } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { Cloud, Moon, Sun } from 'lucide-react'
import type { SessionClock } from '../lib/sessionClock'
import { skyAt, sampleIntervalMs } from '../lib/simulation'

export default function SkyScene({ worldClock, elapsed, running, rate }: { worldClock: SessionClock; elapsed: number; running: boolean; rate: number }) {
  const clock = useMotionValue(elapsed)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!running || reduced || Math.abs(clock.get() - elapsed) > 1) { clock.set(elapsed); return }
    const animation = animate(clock, elapsed, { duration: sampleIntervalMs(rate) / 1000, ease: 'linear' })
    return () => animation.stop()
  }, [clock, elapsed, running, rate, reduced])
  const sunX = useTransform(clock, t => `${skyAt(t, worldClock).sun.x}%`)
  const sunY = useTransform(clock, t => skyAt(t, worldClock).sun.y)
  const sunOpacity = useTransform(clock, t => skyAt(t, worldClock).sun.opacity)
  const moonX = useTransform(clock, t => `${skyAt(t, worldClock).moon.x}%`)
  const moonY = useTransform(clock, t => skyAt(t, worldClock).moon.y)
  const moonOpacity = useTransform(clock, t => skyAt(t, worldClock).moon.opacity)
  const nightOpacity = useTransform(clock, t => 1 - skyAt(t, worldClock).light)
  return <div className="sky-world" aria-hidden="true">
    <div className="sky-day-layer" /><motion.div className="sky-night-layer" style={{ opacity: nightOpacity }} />
    <motion.div className="sky-stars" style={{ opacity: nightOpacity }}>· ˚ · ✦ · ˚ ·</motion.div>
    <div className="sky-orbit">
      <motion.span className="orb sun-orb" style={{ left: sunX, y: sunY, opacity: sunOpacity }}><Sun /></motion.span>
      <motion.span className="orb moon-orb" style={{ left: moonX, y: moonY, opacity: moonOpacity }}><Moon /></motion.span>
    </div>
    <Cloud className="scene-cloud cloud-one" /><Cloud className="scene-cloud cloud-two" /><Cloud className="scene-cloud cloud-three" />
  </div>
}
