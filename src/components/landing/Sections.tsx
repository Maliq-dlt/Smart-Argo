import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Activity, ArrowRight, BatteryCharging, Droplets, FlaskConical, Gift, LayoutDashboard, Leaf, QrCode, Sprout, Thermometer, WifiOff } from 'lucide-react'
import { formatNumber, hours, localeText, pickCase, solarInput, solarSizing, thresholds } from '../../lib/landingNarrative'

gsap.registerPlugin(ScrollTrigger)
const ENERGY_WINDOW_POINTS = 120

/** Counts up once when it scrolls into view. */
function Count({ to, digits = 0 }: { to: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const show = (v: number) => { el.textContent = formatNumber(v, digits) }
    if (reduced) { show(to); return }
    show(0)
    const box = { v: 0 }
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      io.disconnect()
      gsap.to(box, { v: to, duration: 1.4, ease: 'power3.out', onUpdate: () => show(box.v) })
    }, { threshold: .4 })
    io.observe(el)
    return () => { io.disconnect(); gsap.killTweensOf(box) }
  }, [to, digits])
  return <span ref={ref}>{formatNumber(to, digits)}</span>
}

// Tile layout and the scrubbed chart follow "Analytics Bento" by romanvasnev on 21st.dev
// (https://21st.dev/@romanvasnev/components/analytics-bento), retrieved 12 Nov 2026, redrawn light.
export function FeatureBento() {
  const { data, limit, solar } = useMemo(() => {
    const { data } = pickCase('cabai', 'dry')
    return { data, limit: thresholds(data), solar: solarSizing() }
  }, [])
  const samples = data.samples
  const [hover, setHover] = useState<number | null>(null)
  const X = (h: number) => 20 + h / data.now_h * 460, Y = (m: number) => 200 - m * 1.8
  const path = samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.t_h)} ${Y(s.moisture)}`).join(' ')
  const area = `${path} L${X(data.now_h)} 200 L20 200 Z`
  const shown = samples[hover ?? samples.length - 1]
  const battery = solarInput.currentSocPct
  const qr = useMemo(() => Array.from({ length: 81 }, (_, i) => ((i * 37 + (i >> 2) * 11) % 7) < 3 || [0, 1, 2, 9, 11, 18, 19, 20, 6, 7, 8, 15, 17, 24, 25, 26, 54, 55, 56, 63, 65, 72, 73, 74].includes(i)), [])

  return <section id="fitur" className="sa-bento" aria-labelledby="sa-bento-title">
    <header className="sa-section-head" data-rise-group>
      <h2 id="sa-bento-title" data-rise>Satu pot, <em>satu ekosistem.</em></h2>
      <p data-rise>Sudah berjalan di simulator dan backend lokal.</p>
    </header>
    <div className="sa-bento-grid" data-rise-group>
      <article className="sa-tile sa-tile-chart" data-rise>
        <div className="sa-tile-head"><span className="sa-tile-icon"><Droplets aria-hidden="true" /></span><h3>Riwayat yang bisa dibaca</h3></div>
        <p className="sa-tile-big"><span>{shown.moisture}</span><small>/100 · {shown.t_h === 0 ? 'baru disiram' : hours(shown.t_h)}</small></p>
        <svg viewBox="0 0 500 220" className="sa-tile-svg" role="img" aria-label={`Indeks kelembapan cabai dari ${samples[0].moisture} ke ${samples.at(-1)!.moisture}`}
          onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const h = Math.max(0, Math.min(1, ((event.clientX - box.left) / box.width * 500 - 20) / 460)) * data.now_h; setHover(Math.round(h / .5)) }}
          onPointerLeave={() => setHover(null)}>
          <path className="sa-area" d={area} /><path className="sa-line" d={path} />
          <path className="sa-limit-line" d={`M20 ${Y(limit.dry)}H480`} /><text x="480" y={Y(limit.dry) - 8} textAnchor="end">batas kering {limit.dry}</text>
          {hover !== null && <path className="sa-scrub" d={`M${X(shown.t_h)} 10V200`} />}
          {samples.map((s, i) => <circle key={s.t_h} cx={X(s.t_h)} cy={Y(s.moisture)} r={i === (hover ?? samples.length - 1) ? 7 : 4} />)}
        </svg>
      </article>

      <article className="sa-tile sa-tile-dark sa-tile-battery" data-rise>
        <div className="sa-tile-head"><span className="sa-tile-icon"><BatteryCharging aria-hidden="true" /></span><h3>Surya dan baterai</h3></div>
        <div className="sa-ring" style={{ '--p': battery } as React.CSSProperties}><span><Count to={battery} />%</span></div>
        <p>{formatNumber(solar.dailyEnergyWh)} Wh per hari</p>
      </article>

      <article className="sa-tile sa-tile-lime" data-rise>
        <div className="sa-tile-head"><span className="sa-tile-icon"><QrCode aria-hidden="true" /></span><h3>Aktivasi sekali pakai</h3></div>
        <div className="sa-qr" aria-hidden="true">{qr.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}</div>
        <p>Kode tersegel, ditandatangani Ed25519.</p>
      </article>

      <article className="sa-tile sa-tile-profile" data-rise>
        <img src="./landing/kohler-capsicum.webp" alt="Pelat botani Capsicum annuum karya Köhler, 1897" width="1100" height="1362" loading="lazy" decoding="async" />
        <div>
          <div className="sa-tile-head"><span className="sa-tile-icon"><Leaf aria-hidden="true" /></span><h3>Profil tanaman yang dikurasi</h3></div>
          <p>Batas kering dan basah untuk tiap tanaman, dinilai oleh kurator.</p>
        </div>
      </article>

      <article className="sa-tile sa-tile-points" data-rise>
        <div className="sa-tile-head"><span className="sa-tile-icon"><Gift aria-hidden="true" /></span><h3>Poin dari merawat</h3></div>
        <p className="sa-tile-big"><span>+<Count to={ENERGY_WINDOW_POINTS} /></span><small>poin</small></p>
        <p>Ditukar dengan dolomit, nutrisi, atau kalibrasi pH.</p>
      </article>

      <article className="sa-tile sa-tile-dark sa-tile-offline" data-rise>
        <div className="sa-tile-head"><span className="sa-tile-icon"><WifiOff aria-hidden="true" /></span><h3>Jalan tanpa internet</h3></div>
        <p className="sa-tile-big"><span>100%</span><small>di browser</small></p>
      </article>
    </div>
  </section>
}

// Glass treatment after "Adjustable Glass Dashboard" by automate_flows on 21st.dev
// (https://21st.dev/@automate_flows/components/adjustable-glass-dashboard), retrieved 12 Nov 2026:
// a blurred, tinted panel with a lit top edge over a photograph. The scroll tilt follows the popular
// "Container Scroll Animation" pattern. Contents are a preview of Smart Agro's own dashboard.
export function GlassDashboard() {
  const root = useRef<HTMLElement>(null)
  const { data, decision, limit } = useMemo(() => { const example = pickCase('cabai', 'dry'); return { ...example, limit: thresholds(example.data) } }, [])
  const last = data.samples.at(-1)!
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.fromTo('.sa-glass-window', { rotateX: 24, scale: .88, y: 60 }, { rotateX: 0, scale: 1, y: 0, ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top 85%', end: 'top 15%', scrub: .6 } })
    }, root)
    return () => ctx.revert()
  }, [])
  const X = (h: number) => 10 + h / data.now_h * 520, Y = (m: number) => 130 - m * 1.2
  const path = data.samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.t_h)} ${Y(s.moisture)}`).join(' ')
  return <section id="dashboard" ref={root} className="sa-dash" aria-labelledby="sa-dash-title">
    <img className="sa-dash-photo" src="./landing/potted-chili.webp" alt="" width="900" height="1092" loading="lazy" decoding="async" />
    <header className="sa-section-head is-light" data-rise-group>
      <h2 id="sa-dash-title" data-rise>Semua yang dibaca sensor, <em>di satu layar.</em></h2>
    </header>
    <div className="sa-glass-scene">
      <div className="sa-glass-window" role="img" aria-label={`Pratinjau dashboard: kelembapan ${last.moisture}, suhu ${last.temp_c} derajat, pH ${last.ph}; saran ${decision.action}.`}>
        <div className="sa-glass-top"><span className="sa-glass-brand"><Sprout aria-hidden="true" />Smart Agro</span><span>Pot {data.profile.pot_id} · {data.profile.crop} · {data.profile.phase}</span><span className="sa-pill-live"><i />Simulasi</span></div>
        <div className="sa-glass-body">
          <nav className="sa-glass-dock" aria-hidden="true">{[LayoutDashboard, Activity, Droplets, BatteryCharging, Gift].map((Icon, i) => <span key={i} className={i === 0 ? 'on' : ''}><Icon /></span>)}</nav>
          <div className="sa-glass-grid">
            {[{ icon: Droplets, label: 'Kelembapan', value: `${last.moisture}`, unit: '/100' }, { icon: Thermometer, label: 'Suhu tanah', value: `${last.temp_c}`, unit: '°C' }, { icon: FlaskConical, label: 'pH media', value: formatNumber(last.ph ?? 0), unit: '' }].map(stat =>
              <div key={stat.label} className="sa-glass-card"><span className="sa-c-label"><stat.icon aria-hidden="true" />{stat.label}</span><strong>{stat.value}<small>{stat.unit}</small></strong></div>)}
            <div className="sa-glass-card sa-glass-chart"><span className="sa-c-label">Kelembapan, 2,5 jam terakhir</span>
              <svg viewBox="0 0 540 140" aria-hidden="true"><path className="sa-limit-line" d={`M10 ${Y(limit.dry)}H530`} /><path className="sa-line" d={path} />{data.samples.map(s => <circle key={s.t_h} cx={X(s.t_h)} cy={Y(s.moisture)} r="4" />)}</svg></div>
            <div className="sa-glass-card sa-glass-decision"><span className="sa-c-label">Saran</span><strong>{decision.action}</strong><p>{localeText(decision.reason)}</p></div>
          </div>
        </div>
      </div>
    </div>
    <div className="sa-dash-cta"><a className="sa-btn sa-btn-light" href="#statistik">Buka dashboard <ArrowRight aria-hidden="true" /></a></div>
  </section>
}

const answers = [
  ['Apakah Smart Agro sudah bisa dibeli?', 'Belum. Ini prototipe: simulator berjalan di browser, dan backend lokal menyediakan akun, aktivasi, serta telemetri bertanda tangan. Perangkat fisiknya belum diuji di lapangan.'],
  ['Apakah indeks kelembapan sama dengan persentase air?', 'Tidak. Indeks 0 sampai 100 adalah bacaan sensor yang dibandingkan dengan acuan media pot itu, bukan kadar air volumetrik.'],
  ['Apakah Smart Agro menyiram sendiri?', 'Tidak. Belum ada kendali pompa atau katup. Smart Agro memberi saran pemeriksaan beserta alasannya; keputusan tetap di tanganmu.'],
  ['Kenapa sarannya sering “periksa”, bukan “siram”?', 'Satu probe hanya membaca satu titik di pot. Penurunan cepat bisa berarti tanaman haus, bisa juga probe bergeser. Memeriksa dulu lebih aman daripada menambah air.'],
  ['Di mana data saya disimpan?', 'Simulator menyimpan sesi di browsermu. Dengan backend lokal lewat Docker, data tersimpan di PostgreSQL pada komputermu.'],
  ['Apakah ada AI atau blockchain?', 'Keputusan dibuat oleh aturan yang bisa dibaca, bukan AI. Ringkasan AI dan bukti blockchain masih rancangan; belum ada transaksi sungguhan.'],
]

export function Faq() {
  return <section id="tanya" className="sa-faq" aria-labelledby="sa-faq-title">
    <header className="sa-section-head" data-rise-group>
      <h2 id="sa-faq-title" data-rise>Jawaban <em>yang jujur.</em></h2>
    </header>
    <div className="sa-faq-list" data-rise-group>
      {answers.map(([q, a], i) => <details key={q} name="sa-faq" open={i === 0} data-rise>
        <summary><span>{q}</span><i aria-hidden="true" /></summary><p>{a}</p>
      </details>)}
    </div>
  </section>
}

export function Marquee() {
  const words = ['Amati', 'Pahami', 'Rawat']
  const run = <span className="sa-marquee-run">{Array.from({ length: 3 }, (_, n) => words.map(word => <span key={`${n}-${word}`}>{word}<Leaf aria-hidden="true" /></span>))}</span>
  return <div className="sa-marquee" aria-label="Amati, pahami, rawat." role="img"><div className="sa-marquee-track">{run}{run}</div></div>
}
