import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { ArrowRight, Sprout } from 'lucide-react'
import HeroPlant from './landing/HeroPlant'
import RootStory from './landing/RootStory'
import TiltStackScroll, { type TiltStackCard } from './landing/TiltStackScroll'
import WaterLab from './landing/WaterLab'
import { FeatureBento, GlassDashboard, Faq, Marquee } from './landing/Sections'
import MeadowRiseFooter, { type MeadowPaletteOverrides } from './landing/MeadowRiseFooter'
import ThemeToggle from './ThemeToggle'
import './landing.css'

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)

const steps: TiltStackCard[] = [
  { title: 'Baca zona akar', image: './landing/soil-probe.webp', alt: 'Probe kelembapan tanah analog tertancap di rumput',
    description: 'Kelembapan, suhu, dan pH setiap 30 menit.', accent: '#c3df95' },
  { title: 'Saring data meragukan', image: './landing/esp32-board.webp', alt: 'Papan pengembangan ESP32 di atas breadboard',
    description: 'Bacaan basi atau melonjak ditahan dulu.', accent: '#c3df95' },
  { title: 'Bandingkan dengan profil', image: './landing/chili-harvest.webp', alt: 'Seorang perempuan memetik cabai merah dan hijau di kebun',
    description: 'Tiap tanaman punya batas kering dan basah sendiri.', accent: '#c3df95' },
  { title: 'Jelaskan alasannya', image: './landing/watering.webp', alt: 'Petani membawa gembor air di atas kepala di jalan kebun',
    description: 'Saran yang bisa dibaca, keputusan tetap di tanganmu.', cta: 'Coba simulator', href: '#simulasi', accent: '#c3df95' },
]

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

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null), scrollTween = useRef<gsap.core.Tween | null>(null)
  const reduced = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  const theme = useDocumentTheme()

  const goTo = useCallback((id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    scrollTween.current?.kill()
    target.focus({ preventScroll: true })
    if (reduced) target.scrollIntoView({ behavior: 'instant' })
    else scrollTween.current = gsap.to(window, { scrollTo: { y: target, autoKill: true }, duration: 1.2, ease: 'power3.inOut' })
  }, [reduced])
  const jump = (id: string) => (event: React.MouseEvent) => { event.preventDefault(); goTo(id) }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); scrollTween.current?.kill() }
  }, [])

  // Every block marked data-rise lifts in once, staggered within its group.
  useLayoutEffect(() => {
    if (!root.current) return
    const ctx = gsap.context(() => {
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        gsap.utils.toArray<HTMLElement>('[data-rise-group]').forEach(group => {
          const parts = group.querySelectorAll(':scope [data-rise]')
          if (parts.length) gsap.from(parts, { y: 36, opacity: 0, duration: .9, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: group, start: 'top 88%', once: true } })
        })
      })
    }, root)
    const refresh = () => ScrollTrigger.refresh()
    window.addEventListener('load', refresh)
    const resize = new ResizeObserver(refresh)
    resize.observe(root.current)
    return () => { window.removeEventListener('load', refresh); resize.disconnect(); ctx.revert() }
  }, [])

  return <div ref={root} className="ag-landing sa">
    <div className="sa-aurora" aria-hidden="true"><span /><span /><span /></div>
    <a className="sa-skip" href="#cerita" onClick={jump('cerita')}>Lewati ke cerita</a>
    <header className={`sa-nav${scrolled ? ' is-scrolled' : ''}`}>
      <a className="sa-logo" href="#landing-main" onClick={jump('landing-main')}><Sprout aria-hidden="true" />smart agro</a>
      <nav aria-label="Bagian halaman">
        <a href="#cara-kerja" onClick={jump('cara-kerja')}>Cara kerja</a><a href="#lab" onClick={jump('lab')}>Lab siram</a><a href="#fitur" onClick={jump('fitur')}>Fitur</a>
      </nav>
      <div className="sa-nav-end"><ThemeToggle /><a className="sa-btn sa-btn-dark sa-nav-cta ag-simulator-link" href="#simulasi" aria-label="Coba simulator"><span className="sa-xs-hide">Coba simulator</span><span className="sa-xs-show" aria-hidden="true">Simulator</span><ArrowRight aria-hidden="true" /></a></div>
    </header>

    <main id="landing-main" tabIndex={-1}>
      <HeroPlant onExplore={() => goTo('cerita')} />
      <RootStory />
      <section id="cara-kerja" className="sa-steps" aria-label="Cara kerja">
        <TiltStackScroll cards={steps} eyebrow="" heading="Dari tanah ke saran" snap={false} />
      </section>
      <WaterLab />
      <FeatureBento />
      <GlassDashboard />
      <Faq />
      <Marquee />
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
        { title: 'Halaman ini', links: [{ label: 'Cerita', href: '#cerita' }, { label: 'Cara kerja', href: '#cara-kerja' }, { label: 'Lab siram', href: '#lab' }, { label: 'Tanya jawab', href: '#tanya' }] },
        { title: 'Proyek', links: [{ label: 'Kode sumber', href: 'https://github.com/Maliq-dlt/Smart-Argo' }, { label: 'Kredit gambar', href: 'https://github.com/Maliq-dlt/Smart-Argo/blob/main/public/landing/CREDITS.md' }] },
      ]}
      socialTitle=""
      socials={[]}
      copyright="Smart Agro · Foto: Sealman, Edwiyanto, FBilula (CC BY-SA 4.0), Dean Sewell/WaterAid (CC BY 2.0), Tinjure20 (CC0), via Wikimedia Commons dan WordPress Photos · Pelat botani: F. E. Köhler, 1897 (domain publik) · Komponen: kedhareswer, Aakash Mehra, romanvasnev, automate_flows di 21st.dev."
      legal={[]}
      fontFamily='"General Sans", "Segoe UI", system-ui, sans-serif'
      serifFamily='"Fraunces", Georgia, serif'
    />
  </div>
}
