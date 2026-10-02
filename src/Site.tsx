import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useReducedMotion } from 'framer-motion'
import LandingPage from './components/LandingPage'
import { isSimulatorHash } from './lib/siteRoute'

type SimulatorModule = typeof import('./App')
let cachedSimulator: SimulatorModule | null = null

class SimulatorBoundary extends Component<{ children: ReactNode; loadFailed: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed || this.props.loadFailed) return <main className="site-loading" role="alert" tabIndex={-1}>
      <h1>Simulator belum dapat dibuka.</h1>
      <p>Muat ulang untuk mencoba lagi. Simpanan sesi tetap berada di browser.</p>
      <button className="landing-cta" onClick={() => location.reload()}>Muat ulang</button>
      <a href="#">Kembali ke beranda</a>
    </main>
    return this.props.children
  }
}

export default function Site() {
  const reduced = useReducedMotion()
  const [route, setRoute] = useState(() => ({ simulator: isSimulatorHash(location.hash), module: cachedSimulator, failed: false, animate: false }))
  const [loading, setLoading] = useState(false)
  const current = useRef(route), request = useRef(0), transition = useRef<ViewTransition | null>(null)
  useEffect(() => {
    let cancelled = false
    const navigate = async () => {
      const id = ++request.current, simulator = isSimulatorHash(location.hash)
      transition.current?.skipTransition()
      let module = cachedSimulator, failed = false
      if (simulator && !module) {
        setLoading(!current.current.simulator)
        try { module = cachedSimulator = await import('./App') }
        catch { failed = true }
      }
      if (cancelled || id !== request.current) return
      if (simulator !== isSimulatorHash(location.hash)) { setLoading(false); return }
      setLoading(false)
      if (current.current.simulator === simulator && current.current.module === module && current.current.failed === failed) return
      transition.current?.skipTransition()
      const native = !reduced && typeof document.startViewTransition === 'function'
      const update = () => {
        if (cancelled || id !== request.current) return
        const next = { simulator, module, failed, animate: !reduced && !native }
        current.current = next
        flushSync(() => setRoute(next))
        const target = simulator ? document.getElementById('main') ?? document.querySelector<HTMLElement>('.site-loading') :
          document.getElementById(location.hash.slice(1)) ?? document.getElementById('landing-main')
        if (!simulator && target?.id !== 'landing-main') target?.scrollIntoView({ behavior: 'instant' })
        else window.scrollTo({ top: 0, behavior: 'instant' })
        target?.focus({ preventScroll: true })
      }
      // Fade pattern: https://21st.dev/@su2491251/components/page-transition
      // ponytail: native snapshots avoid moving sticky ancestors; older browsers use a short opacity fade.
      if (!native) { update(); return }
      document.documentElement.dataset.siteTransition = 'true'
      const view = document.startViewTransition(update)
      transition.current = view
      void view.ready.catch(() => { /* A newer navigation may skip snapshot creation. */ })
      void view.finished.catch(() => { /* A hidden tab or a newer navigation can interrupt the snapshot. */ }).finally(() => {
        if (transition.current !== view) return
        transition.current = null
        delete document.documentElement.dataset.siteTransition
      })
    }
    window.addEventListener('hashchange', navigate)
    void navigate()
    return () => { cancelled = true; window.removeEventListener('hashchange', navigate); transition.current?.skipTransition() }
  }, [reduced])
  const Simulator = route.module?.default
  return <>
    <div key={route.simulator ? 'simulator' : 'landing'} className={`site-page${route.animate ? ' site-page-fallback' : ''}`}>
      {route.simulator ? <SimulatorBoundary loadFailed={route.failed}>{Simulator ? <Simulator /> : <main className="site-initial-loading" role="status"><p>Menyiapkan ruang tanam…</p><a href="#">Kembali ke beranda</a></main>}</SimulatorBoundary> : <LandingPage />}
    </div>
    {loading && <aside className="site-pending" role="status"><span>Menyiapkan ruang tanam…</span><button type="button" onClick={() => { location.hash = '#' }}>Batal</button></aside>}
  </>
}
