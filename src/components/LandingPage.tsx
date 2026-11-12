import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowRight, Sprout } from 'lucide-react'
import Hero from './landing/v5/Hero'
import { LeafReveal, Numbers, Problem, Product, RootZone } from './landing/v5/Story'
import Grow from './landing/v5/Grow'
import Explore from './landing/v5/Explore'
import { useLenis } from './landing/v5/smoothScroll'
import MeadowRiseFooter, { type MeadowPaletteOverrides } from './landing/MeadowRiseFooter'
import ThemeToggle from './ThemeToggle'
import './landing.css'

// The footer's painted hills follow the same "Sage dan lumut" palette in dark mode.
const darkMeadow: MeadowPaletteOverrides = {
  sky: ['#141b17', '#1d2822'], haze: '#22302a', glow: '#cfe3c0',
  hills: [['#34453a', '#2a392f'], ['#2f4335', '#25372b'], ['#2b4030', '#213327'], ['#263b2a', '#1c2e21'], ['#20341f', '#17271a'], ['#1b2b1d', '#121e15']],
  ground: '#121a15', ink: '#e8ede6', sub: '#a5afa7', pill: '#e8ede6', pillInk: '#161d19', text: '#e3e9e0', muted: '#8f9b91', line: 'rgba(232, 237, 230, 0.12)', night: true,
}
const lightMeadow: MeadowPaletteOverrides = { sky: ['#eef1e9', '#e2e9d8'], haze: '#e0e7d6' }

/** Follows the theme the simulator's ThemeToggle writes to <html data-theme>. */
function useDocumentTheme() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') as 'light' | 'dark'
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    // ThemeToggle may already have written the attribute in its layout effect, before this observer existed.
    setTheme(read())
    return () => observer.disconnect()
  }, [])
  return theme
}

/* Landing v5, after the Farm Minerals CropTab promo (techniques and story arc only, no copy or assets):
 * problem → hidden cause → device → how it works → numbers → hands-on → explore the prototype → footer. */
export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const lenis = useLenis(!reduced)
  const theme = useDocumentTheme()
  const [scrolled, setScrolled] = useState(false)

  const goTo = useCallback((id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    target.focus({ preventScroll: true })
    if (lenis.current) lenis.current.scrollTo(target, { duration: 1.6, easing: t => 1 - Math.pow(1 - t, 4) })
    else target.scrollIntoView({ behavior: 'instant' })
  }, [lenis])
  const jump = (id: string) => (event: React.MouseEvent) => { event.preventDefault(); goTo(id) }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Sticky stages change height with the viewport and fonts; keep every trigger measured.
  useLayoutEffect(() => {
    const refresh = () => ScrollTrigger.refresh()
    window.addEventListener('load', refresh)
    document.fonts?.ready.then(refresh)
    const resize = new ResizeObserver(refresh)
    resize.observe(root.current!)
    return () => { window.removeEventListener('load', refresh); resize.disconnect() }
  }, [])

  return <div ref={root} className="ag-landing sa v5">
    <a className="sa-skip" href="#masalah" onClick={jump('masalah')}>Lewati ke cerita</a>
    <header className={`sa-nav${scrolled ? ' is-scrolled' : ''}`}>
      <a className="sa-logo" href="#landing-main" onClick={jump('landing-main')}><Sprout aria-hidden="true" />smart agro</a>
      <nav aria-label="Bagian halaman">
        <a href="#masalah" onClick={jump('masalah')}>Masalah</a><a href="#kenalan" onClick={jump('kenalan')}>Cara kerja</a><a href="#rawat" onClick={jump('rawat')}>Coba rawat</a><a href="#jelajah" onClick={jump('jelajah')}>Jelajahi</a>
      </nav>
      <div className="sa-nav-end"><ThemeToggle /><a className="sa-btn sa-btn-dark sa-nav-cta ag-simulator-link" href="#simulasi" aria-label="Coba simulator"><span className="sa-xs-hide">Coba simulator</span><span className="sa-xs-show" aria-hidden="true">Simulator</span><ArrowRight aria-hidden="true" /></a></div>
    </header>

    <main id="landing-main" tabIndex={-1}>
      <Hero onExplore={() => goTo('masalah')} />
      <Problem />
      <Product />
      <RootZone />
      <Numbers />
      <LeafReveal />
      <Grow />
      <Explore />
    </main>

    <MeadowRiseFooter
      key={theme}
      palette={theme === 'dark' ? darkMeadow : lightMeadow}
      name="Smart Agro"
      brandHref="#landing-main"
      logo={<Sprout aria-hidden="true" />}
      heading={'Rawat pot dengan *lebih tenang.*'}
      subheading="Semuanya berjalan di browsermu."
      cta={{ label: 'Coba simulator', href: '#simulasi' }}
      tagline="Prototipe sensor tanah dan simulator perawatan."
      newsletter={false}
      columns={[
        { title: 'Produk', links: [{ label: 'Simulator', href: '#simulasi' }, { label: 'Dashboard', href: '#statistik' }, { label: 'Perangkat', href: '#perangkat' }, { label: 'Ekosistem', href: '#ekosistem' }] },
        { title: 'Halaman ini', links: [{ label: 'Masalah', href: '#masalah' }, { label: 'Cara kerja', href: '#kenalan' }, { label: 'Coba rawat', href: '#rawat' }, { label: 'Jelajahi', href: '#jelajah' }] },
        { title: 'Proyek', links: [{ label: 'Kode sumber', href: 'https://github.com/Maliq-dlt/Smart-Argo' }, { label: 'Kredit gambar', href: 'https://github.com/Maliq-dlt/Smart-Argo/blob/main/public/landing/CREDITS.md' }] },
      ]}
      socialTitle=""
      socials={[]}
      copyright="Smart Agro · Render perangkat dan klip adegan dibuat dengan Google Veo sebagai konsep, bukan foto produk · Foto pot cabai: Tinjure20 (CC0) · Pola komponen: joyco, ajith66310, hyperiux, kedhareswer di 21st.dev."
      legal={[]}
      fontFamily='"General Sans", "Segoe UI", system-ui, sans-serif'
      serifFamily='"Fraunces", Georgia, serif'
    />
  </div>
}
