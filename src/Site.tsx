import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import LandingPage from './components/LandingPage'
import SiteCurtain, { type CurtainHandle } from './components/SiteCurtain'
import { markRevealed } from './lib/curtainSignal'
import { isSimulatorHash } from './lib/siteRoute'

type SimulatorModule = typeof import('./App')
let cachedSimulator: SimulatorModule | null = null

// The landing's hero announces when its first video frame can be shown; listen from the start so it is not missed.
let markHeroReady: () => void = () => {}
const heroReady = new Promise<void>(resolve => { markHeroReady = resolve })
window.addEventListener('smartagro:ready', () => markHeroReady(), { once: true })
const bootStart = performance.now()
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const frames = (n: number) => new Promise<void>(resolve => { const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve()); step(n) })

/** The first lift waits for fonts and the hero video (or the simulator), at least 1.2 s on the landing
 * (0.6 s for a direct link into the simulator) and at most 5 s. */
function bootReady(simulator: boolean) {
  const ready = Promise.all([document.fonts?.ready ?? Promise.resolve(), simulator ? Promise.resolve() : heroReady, wait(Math.max(0, (simulator ? 600 : 1200) - (performance.now() - bootStart)))])
  return Promise.race([ready, wait(Math.max(0, 5000 - (performance.now() - bootStart)))])
}

class SimulatorBoundary extends Component<{ children: ReactNode; loadFailed: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed || this.props.loadFailed) return <main className="site-loading" role="alert" tabIndex={-1}>
      <h1>Simulator belum dapat dibuka.</h1>
      <p>Muat ulang untuk mencoba lagi. Simpanan sesi tetap berada di browser.</p>
      <button className="button" onClick={() => location.reload()}>Muat ulang</button>
      <a href="#">Kembali ke beranda</a>
    </main>
    return this.props.children
  }
}

export default function Site() {
  // Decided once: the curtain plays unless the visitor asked for reduced motion.
  const [animated] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [route, setRoute] = useState(() => ({ simulator: isSimulatorHash(location.hash), module: cachedSimulator, failed: false }))
  const [loading, setLoading] = useState(false)
  const current = useRef(route), request = useRef(0), curtain = useRef<CurtainHandle>(null), booting = useRef(animated)

  useEffect(() => { if (!animated) markRevealed() }, [animated])
  // The static first-paint loader in index.html hands over to the React curtain, which looks the same.
  useLayoutEffect(() => { document.getElementById('boot')?.remove() }, [])

  useEffect(() => {
    let cancelled = false
    const navigate = async () => {
      const id = ++request.current, simulator = isSimulatorHash(location.hash)
      const stale = () => cancelled || id !== request.current
      let module = cachedSimulator, failed = false
      const load = simulator && !module ? import('./App').then(m => (cachedSimulator = m), () => null) : null
      if (animated && !booting.current && current.current.simulator !== simulator) {
        await curtain.current?.cover(simulator ? 'Menyiapkan ruang tanam…' : 'Kembali ke beranda…', !!load)
      } else if (!animated && load) setLoading(!current.current.simulator)
      if (load) { const loaded = await load; if (loaded) module = loaded; else failed = true }
      if (stale()) return
      setLoading(false)
      if (simulator !== isSimulatorHash(location.hash)) return
      if (current.current.simulator !== simulator || current.current.module !== module || current.current.failed !== failed) {
        const next = { simulator, module, failed }
        current.current = next
        flushSync(() => setRoute(next))
        const target = simulator ? document.getElementById('main') ?? document.querySelector<HTMLElement>('.site-loading') :
          document.getElementById(location.hash.slice(1)) ?? document.getElementById('landing-main')
        if (!simulator && target?.id !== 'landing-main') target?.scrollIntoView({ behavior: 'instant' })
        else window.scrollTo({ top: 0, behavior: 'instant' })
        target?.focus({ preventScroll: true })
      }
      if (!animated) return
      if (booting.current) { booting.current = false; await bootReady(simulator) } else await frames(2)
      if (!stale()) await curtain.current?.reveal()
    }
    window.addEventListener('hashchange', navigate)
    void navigate()
    return () => { cancelled = true; window.removeEventListener('hashchange', navigate) }
  }, [animated])

  const Simulator = route.module?.default
  return <>
    <div key={route.simulator ? 'simulator' : 'landing'} className="site-page">
      {route.simulator ? <SimulatorBoundary loadFailed={route.failed}>{Simulator ? <Simulator /> : <main className="site-initial-loading" role="status"><p>Menyiapkan ruang tanam…</p><a href="#">Kembali ke beranda</a></main>}</SimulatorBoundary> : <LandingPage />}
    </div>
    {animated && <SiteCurtain ref={curtain} boot onCancel={() => { location.hash = '#' }} />}
    {loading && <aside className="site-pending" role="status"><span>Menyiapkan ruang tanam…</span><button type="button" onClick={() => { location.hash = '#' }}>Batal</button></aside>}
  </>
}
