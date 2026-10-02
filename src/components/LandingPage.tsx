import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { ArrowRight, ChevronDown, Clock3, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import PlantIllustration from './PlantIllustration'
import FlowerHero from './FlowerHero'
import AgroMark from './AgroMark'
import StickyScroll from './ui/sticky-scroll-reveal'
import AnimatedTabs from './ui/animated-tabs'
import ReadingReveal from './ui/reading-reveal'
import SpotlightCard from './ui/spotlight-card'
import ContainerScroll from './ui/container-scroll'
import { isSimulatorHash } from '../lib/siteRoute'
import { landingExamples, trendPath } from '../lib/landingStory'
import './landing.css'

type LandingExample = typeof landingExamples[number]
const format = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 })

function PotScene({ cover = 1, sensors = 0, moisture = 85 }: { cover?: number; sensors?: number; moisture?: number }) {
  return <figure className="landing-scene">
    <PlantIllustration viewBox="0 120 460 365" day={24} onion={false} moisture={moisture} contact showSensors shellOpacity={cover} sensorOpacity={sensors} />
    <figcaption>Penampang pot cabai · ilustrasi konsep</figcaption>
  </figure>
}

function Trend({ item }: { item: LandingExample }) {
  const reduced = useReducedMotion()
  const { data, reading } = item
  const first = data.samples[0]
  return <figure className="landing-trend">
    <figcaption><span>Riwayat kelembapan</span><span>Indeks / 100</span></figcaption>
    <svg viewBox="0 0 400 96" role="img" aria-label={`Indeks kelembapan dari ${first.moisture} ke ${reading.moisture} selama ${format(data.now_h - first.t_h)} jam.`}>
      <path d="M8 8H392M8 44H392M8 80H392" className="landing-trend-grid" />
      <motion.path key={data.name} d={trendPath(data.samples)} className="landing-trend-line" initial={reduced ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, amount: .6 }} transition={{ duration: 1.1, ease: [.22, 1, .36, 1] }} />
      <circle cx="392" cy={80 - reading.moisture * .72} r="4" />
    </svg>
    <div className="landing-trend-axis"><span>Awal pengamatan</span><span>{format(data.now_h - first.t_h)} jam kemudian</span></div>
  </figure>
}

function Readings({ item }: { item: LandingExample }) {
  return <dl className="landing-readings">
    <div><dt>Kelembapan</dt><dd>{format(item.reading.moisture)}<small>indeks / 100</small></dd></div>
    <div><dt>Suhu media</dt><dd>{format(item.reading.temp_c)}<small>°C</small></dd></div>
    <div><dt>pH media</dt><dd>{item.reading.ph === null ? 'Tidak diukur' : format(item.reading.ph)}<small>pH</small></dd></div>
  </dl>
}

export default function LandingPage() {
  const reduced = useReducedMotion()
  const [choice, setChoice] = useState(0)
  const [sensor, setSensor] = useState(0)
  const selected = landingExamples[choice]
  const sensorNotes = [
    { name: 'Kelembapan', model: 'Kapasitif V1.2', detail: 'Indeks kapasitif, bukan persentase kadar air. Kontak probe dan acuan lokal menentukan cara model membaca nilainya.', x: '62.4%' },
    { name: 'Suhu', model: 'DS18B20', detail: 'Suhu media dibaca dalam °C. Model memakai konteks suhu saat mengevaluasi kondisi panas.', x: '35.7%' },
    { name: 'pH', model: 'pH + DMS', detail: 'Keasaman media perlu pengukuran yang sah. Model menahan aturan pH saat data belum tervalidasi.', x: '67.8%' },
  ]
  useEffect(() => {
    const initialTarget = document.getElementById(location.hash.slice(1))
    if (initialTarget && !isSimulatorHash(location.hash)) {
      initialTarget.focus({ preventScroll: true })
      initialTarget.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
    if (reduced) return
    const lenis = new Lenis({ autoRaf: true, duration: .9, anchors: false, syncTouch: false })
    const navigate = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null
      const hash = anchor?.getAttribute('href')
      if (!hash || isSimulatorHash(hash)) return
      const target = hash === '#' ? document.getElementById('landing-main') : document.getElementById(hash.slice(1))
      if (!target) return
      event.preventDefault()
      if (location.hash !== hash) history.pushState(null, '', hash)
      target.focus({ preventScroll: true })
      lenis.scrollTo(hash === '#' ? 0 : target, { duration: .9 })
    }
    document.addEventListener('click', navigate)
    return () => { document.removeEventListener('click', navigate); lenis.destroy() }
  }, [reduced])

  const sensorVisual = <div className="story-sensor-visual"><PotScene cover={0} sensors={1} />
    <span className="story-probe-ring" style={{ left: sensorNotes[sensor].x }} />
    <span className="story-probe-label">{sensorNotes[sensor].model}</span>
  </div>
  const chapters = [
    { label: 'Permukaan', title: <>Yang terlihat, <br /><span>belum semuanya.</span></>, description: 'Daun dan permukaan media hanya sebagian cerita. Pengamatan dimulai pada media yang bersentuhan dengan akar.', visual: <div className="story-surface-visual"><PotScene /><span className="story-surface-line">Permukaan media</span></div> },
    { label: 'Zona akar', title: <>Tiga parameter. <br /><span>Satu konteks.</span></>, description: 'Pilih parameter untuk melihat peran dan lokasi probe dalam ilustrasi.', visual: sensorVisual,
      body: <div className="story-sensor-control"><AnimatedTabs label="Parameter zona akar" tabs={sensorNotes.map(item => item.name)} value={sensor} onChange={setSensor} controls="story-sensor-note" /><div id="story-sensor-note" className="story-sensor-note" aria-live="polite" aria-atomic="true"><h3>{sensorNotes[sensor].model}</h3><p>{sensorNotes[sensor].detail}</p></div></div> },
    { label: 'Pola', title: <>Periksa datanya. <br /><span>Baru baca polanya.</span></>, description: 'Bacaan gagal atau terlalu lama menahan saran. Model membaca perubahan dari sampel berurutan, lalu membandingkannya dengan acuan pot.',
      visual: <figure className="story-reasoning"><figcaption>Sebelum memberi saran</figcaption><ol>
        <li><ShieldCheck /><div><span>01 / Mutu data</span><h3>Valid dan mutakhir</h3><p>Status dan umur bacaan diperiksa.</p></div></li>
        <li><Clock3 /><div><span>02 / Perubahan</span><h3>Perhatikan durasi</h3><p>Sampel berurutan memberi konteks pola.</p></div></li>
        <li><SlidersHorizontal /><div><span>03 / Acuan lokal</span><h3>Sesuaikan dengan pot</h3><p>Indeks dibaca terhadap acuan medianya.</p></div></li>
      </ol></figure>,
      body: <a className="story-next" href="#eksperimen">Lihat alasan keputusan <ArrowRight aria-hidden="true" /></a> },
  ]

  return <div className="landing-page">
    <a className="skip-link" href="#landing-main">Lewati navigasi</a>
    <header className="landing-nav">
      <a className="landing-brand" href="#" aria-label="Smart Agro · Beranda"><AgroMark /><span>smart<span>agro</span></span></a>
      <a className="landing-nav-cta" href="#simulasi">Coba simulator <ArrowRight aria-hidden="true" /></a>
    </header>
    <main id="landing-main" tabIndex={-1}>
      <FlowerHero />
      <div className="story-bridge"><ReadingReveal text="Yang terlihat hanya sebagian. Riwayat media memberi konteks." /></div>
      <StickyScroll content={chapters} probe={sensorNotes[sensor]} />
      <section id="eksperimen" tabIndex={-1} className="landing-experiment" aria-labelledby="landing-experiment-title">
        <div className="landing-experiment-heading">
          <p className="landing-eyebrow">Dua kondisi, dua keputusan</p>
          <h2 id="landing-experiment-title">Riwayat berbeda. <br /><span>Langkah berbeda.</span></h2>
          <div className="landing-scenario-switch"><p>Pilih kondisi media</p><AnimatedTabs label="Coba dua kondisi media" tabs={landingExamples.map(item => item.label)} value={choice} onChange={setChoice} controls="landing-result landing-experiment-data" /></div>
        </div>
        <ContainerScroll>
          <SpotlightCard id="landing-experiment-data" className="landing-experiment-data" role="region" aria-label={`Pengamatan contoh: ${selected.label}`}>
            <div className="landing-lab-heading"><h3>Pengamatan media</h3><span>Contoh simulasi · {selected.label}</span></div>
            <Readings item={selected} />
            <div className="landing-lab-analysis">
              <Trend item={selected} />
              <div id="landing-result" className="landing-result" aria-live="polite" aria-atomic="true">
                <p className="landing-example-label">Langkah berikutnya</p>
                <h3>{selected.decision.action}</h3><p>{selected.decision.reason}</p>
              </div>
            </div>
            <p className="landing-data-note">Data skenario bawaan, bukan pembacaan perangkat.</p>
          </SpotlightCard>
        </ContainerScroll>
      </section>
      <section className="landing-invitation" aria-labelledby="landing-invitation-title">
        <div className="landing-invitation-inner">
          <h2 id="landing-invitation-title">Sekarang, <br /><span>coba sendiri.</span></h2>
          <p>Jelajahi simulasi perawatan cabai dan bawang.</p>
          <a className="landing-cta" href="#simulasi">Coba simulator <ArrowRight aria-hidden="true" /></a>
          <p className="landing-limit">Simulasi lokal. Belum terhubung ke perangkat.</p>
        </div>
        {/* Feature Accordion Section: https://21st.dev/@ruixen.ui/components/feature-accordion-section */}
        <div className="landing-faq" role="group" aria-label="Sebelum mencoba simulator">
          <h3>Sebelum mulai</h3>
          <details name="landing-faq"><summary>Apakah nilainya berasal dari sensor?<ChevronDown aria-hidden="true" /></summary><p>Belum. Nilai berasal dari model simulasi dan skenario bawaan. Riwayat membantu menjelaskan alasan keputusan, tanpa pembacaan perangkat nyata.</p></details>
          <details name="landing-faq"><summary>Tanaman apa yang bisa dicoba?<ChevronDown aria-hidden="true" /></summary><p>Cabai dan bawang melalui perjalanan tanam atau eksperimen. Galeri bunga memperkenalkan cerita secara visual, bukan jenis tanaman yang didiagnosis simulator.</p></details>
          <details name="landing-faq"><summary>Bisa langsung mengikuti saran perawatannya?<ChevronDown aria-hidden="true" /></summary><p>Gunakan untuk latihan membaca pola. Model belum divalidasi secara agronomi; perawatan nyata tetap memerlukan pemeriksaan media, kondisi tanaman, dan acuan lokal.</p></details>
        </div>
      </section>
    </main>
    <footer className="landing-footer"><span><AgroMark />Smart Agro</span><p>Simulasi lokal · Cabai &amp; bawang</p></footer>
  </div>
}
