// Scroll story in the manner of Farm Minerals' CropTab page (Awwwards nominee, 2026): a statement whose
// words light up as you read, then one pinned stage where the device drops in and the numbers run.
// Every figure comes from the "Cabai 55 cepat mengering" scenario and the rule engine.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { decisionsOverTime, dryShare, hours, localeText, pickCase, ruleOf, thresholds } from '../../lib/landingNarrative'

gsap.registerPlugin(ScrollTrigger)

const statement = 'Daun bisa tampak segar, sementara zona akarnya sudah mulai kering.'
const SOIL = { top: 130, bottom: 392 }
// Grains scattered over the soil face, fixed so every render is the same.
const grains = Array.from({ length: 70 }, (_, i) => ({ x: 98 + ((i * 53) % 205), y: 140 + ((i * 97) % 240), r: 1.4 + (i % 3) * .7 }))

export default function RootStory() {
  const story = useMemo(() => {
    const { data, decision } = pickCase('cabai', 'dry')
    return { data, decision, steps: decisionsOverTime(data), limit: thresholds(data) }
  }, [])
  const samples = story.data.samples, last = samples.length - 1
  const { evidence } = story.decision
  const phases = [
    { title: 'Pasang probe di zona akar.', body: 'Sampai ke akar, bukan hanya permukaan.' },
    { title: 'Baca setiap 30 menit.', body: `${samples[0].moisture} turun ke ${samples[last].moisture} dalam ${hours(story.data.now_h)}, sementara daunnya tetap tegak.` },
    { title: 'Hitung ke depan.', body: `Batas kering ${story.limit.dry} terlewati sekitar ${hours(evidence.eta_h ?? 0)} lagi.` },
    { title: 'Saran, dengan alasan.', body: localeText(story.decision.reason) },
  ]
  const [phase, setPhase] = useState(0), [reading, setReading] = useState(0)
  const statementRef = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null)

  // Chart geometry: hours 0 to 4 across, index 0 to 100 up.
  const X = (h: number) => 24 + h / 4 * 292, Y = (m: number) => 156 - (m - 25) * 1.8
  const line = samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.t_h).toFixed(1)} ${Y(s.moisture).toFixed(1)}`).join(' ')
  const crossAt = story.data.now_h + (evidence.eta_h ?? 0)
  const projection = `M${X(story.data.now_h)} ${Y(samples[last].moisture)} L${X(crossAt)} ${Y(story.limit.dry)}`

  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = gsap.context(() => {
      const words = statementRef.current?.querySelectorAll('.sa-w')
      if (words?.length) gsap.fromTo(words, { opacity: .14 }, { opacity: 1, stagger: .12, ease: 'none',
        scrollTrigger: { trigger: statementRef.current, start: 'top 75%', end: 'bottom 85%', scrub: reduced ? false : .4 } })

      const timeline = gsap.timeline({ defaults: { ease: 'none' } })
      timeline
        .fromTo('.sa-probe', { y: -560 }, { y: 0, duration: .14, ease: 'power3.in' }, 0)
        .fromTo('.sa-burst circle', { scale: 0, opacity: 1, transformOrigin: '50% 50%' }, { scale: 1, opacity: 0, x: (i: number) => (i % 2 ? 1 : -1) * (14 + i * 6), y: (i: number) => -20 - (i % 3) * 14, duration: .06, stagger: .004 }, .14)
        .fromTo('.sa-dry', { attr: { height: dryShare(samples[0].moisture) * (SOIL.bottom - SOIL.top) } }, { attr: { height: dryShare(samples[last].moisture) * (SOIL.bottom - SOIL.top) }, duration: .44 }, .18)
        .fromTo('.sa-chart-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: .44 }, .18)
        .fromTo('.sa-chart-projection', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: .12 }, .64)
        .fromTo('.sa-card-chart', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .06 }, .16)
        .fromTo('.sa-card-reading', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .06 }, .14)
        .fromTo('.sa-card-decision', { x: 60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: .08 }, .82)
        .to({}, { duration: .1 }, .9)
      ScrollTrigger.create({
        trigger: track.current, start: 'top top', end: 'bottom bottom', animation: timeline, scrub: reduced ? true : .6,
        onUpdate: self => {
          const p = self.progress
          setPhase(p < .18 ? 0 : p < .62 ? 1 : p < .82 ? 2 : 3)
          setReading(Math.max(0, Math.min(last, Math.floor((p - .18) / .44 * (last + 1)))))
        },
      })
    })
    return () => ctx.revert()
  }, [last, samples])

  const sample = samples[reading]
  return <>
    <section className="sa-statement" aria-labelledby="sa-statement-title">
      <div ref={statementRef} className="sa-statement-inner">
        <h2 id="sa-statement-title">{statement.split(' ').map((word, i) => <span key={i} className="sa-w">{word} </span>)}</h2>
        <p className="sa-statement-sub">Smart Agro membaca bagian yang tidak terlihat dari atas.</p>
      </div>
    </section>

    <section id="cerita" className="sa-story" aria-labelledby="sa-story-title" tabIndex={-1}>
      <div ref={track} className="sa-story-track">
        <div className="sa-story-stage">
          <div className="sa-story-copy">
            <h2 id="sa-story-title" className="sa-sr">Mengikuti satu pot cabai selama dua setengah jam</h2>
            <ol className="sa-phases" aria-live="polite">
              {phases.map((item, i) => <li key={item.title} className={i === phase ? 'is-active' : i < phase ? 'is-done' : ''}>
                <h3>{item.title}</h3><p>{item.body}</p>
              </li>)}
            </ol>
            <div className="sa-progress" aria-hidden="true">{phases.map((item, i) => <span key={item.title} className={i <= phase ? 'is-on' : ''} />)}</div>
            <div className="sa-card sa-card-chart" aria-hidden="true">
              <span className="sa-c-label">Riwayat dan proyeksi</span>
              <svg viewBox="0 0 330 170">
                <path className="sa-chart-limit" d={`M24 ${Y(story.limit.dry)}H316`} />
                <text x="316" y={Y(story.limit.dry) - 6} textAnchor="end">batas kering {story.limit.dry}</text>
                <path className="sa-chart-projection" pathLength={1} d={projection} />
                <path className="sa-chart-line" pathLength={1} d={line} />
                {samples.slice(0, reading + 1).map(s => <circle key={s.t_h} cx={X(s.t_h)} cy={Y(s.moisture)} r="4" />)}
              </svg>
            </div>
          </div>

          <div className="sa-story-visual">
            <svg className="sa-pot" viewBox="-40 -540 480 980" aria-hidden="true">
              <defs><clipPath id="sa-soil"><polygon points={`86,${SOIL.top} 314,${SOIL.top} 290,${SOIL.bottom} 110,${SOIL.bottom}`} /></clipPath>
                <clipPath id="sa-above"><rect x="-400" y="-540" width="1200" height={SOIL.top + 540} /></clipPath></defs>
              <image href="./plants/cabai.webp" x="-282" y="-870" width="952" height="1309" clipPath="url(#sa-above)" />
              <path className="sa-pot-body" d="M72 120h256l-30 280a14 14 0 0 1-14 12H116a14 14 0 0 1-14-12Z" />
              <rect className="sa-pot-rim" x="56" y="94" width="288" height="36" rx="12" />
              <polygon className="sa-soil-wet" points={`86,${SOIL.top} 314,${SOIL.top} 290,${SOIL.bottom} 110,${SOIL.bottom}`} />
              <rect className="sa-dry" clipPath="url(#sa-soil)" x="80" y={SOIL.top} width="240" height="0" />
              <g clipPath="url(#sa-soil)" className="sa-grains">{grains.map((g, i) => <circle key={i} cx={g.x} cy={g.y} r={g.r} />)}</g>
              <g clipPath="url(#sa-soil)" className="sa-roots">
                <path d="M200 130C198 190 186 240 166 300" /><path d="M200 160C214 210 232 260 236 330" /><path d="M197 200C176 228 150 262 140 330" />
                <path d="M203 222C224 250 252 284 262 340" /><path d="M194 250C198 290 192 330 196 380" />
              </g>
              <g className="sa-probe">
                <rect className="sa-probe-pin" x="232" y="96" width="6" height="210" rx="3" /><rect className="sa-probe-pin" x="248" y="96" width="6" height="210" rx="3" />
                <rect className="sa-probe-head" x="220" y="40" width="46" height="66" rx="14" /><circle className="sa-probe-led" cx="243" cy="60" r="5" />
                <g className="sa-sense"><circle cx="243" cy="300" r="16" /><circle cx="243" cy="300" r="30" /></g>
              </g>
              <g className="sa-burst">{Array.from({ length: 8 }, (_, i) => <circle key={i} cx={243} cy={SOIL.top} r={4 + (i % 3)} />)}</g>
            </svg>

            <div className="sa-card sa-card-reading" aria-hidden="true">
              <span className="sa-c-label">Indeks kelembapan</span>
              <strong>{sample.moisture}<small>/100</small></strong>
              <span className="sa-c-note">{sample.t_h === 0 ? 'Baru disiram' : `${hours(sample.t_h)} kemudian`}</span>
            </div>
            <div className="sa-card sa-card-decision" aria-hidden="true">
              <span className="sa-c-label"><i />{ruleOf(story.decision).label}</span>
              <strong>{story.decision.action}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  </>
}
