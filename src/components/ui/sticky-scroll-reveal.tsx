import { useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import PlantIllustration from '../PlantIllustration'

export interface StickyScrollProps {
  content: { label: string; title: ReactNode; description: ReactNode; body?: ReactNode; visual: ReactNode }[]
  probe: { x: string; model: string }
}

// Adapted from manuarora700: https://21st.dev/@manuarora700/components/sticky-scroll-reveal
// Camera continuity informed by https://cornrevolution.resn.global/#, using our own SVG and content.
export default function StickyScroll({ content, probe }: StickyScrollProps) {
  const root = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: root, offset: ['start start', 'end end'] })
  // ponytail: three chapters share one pot; extend these stops if the narrative gains a fourth scene.
  const scale = useTransform(scrollYProgress, [0, .4, .7, 1], [.95, 1.4, 1.4, .92])
  const y = useTransform(scrollYProgress, [0, .4, .7, 1], ['-3%', '-20%', '-20%', '-16%'])
  const shell = useTransform(scrollYProgress, [0, .08, .35, 1], [1, 1, 0, 0])
  const sensors = useTransform(scrollYProgress, [0, .27, .43, 1], [0, 0, 1, 1])
  const probeOpacity = useTransform(scrollYProgress, [0, .27, .43, .72, .85, 1], [0, 0, 1, 1, 0, 0])
  useMotionValueEvent(scrollYProgress, 'change', value => setActive(previous => Math.abs(value * Math.max(0, content.length - 1) - previous) > .53 ? Math.round(value * Math.max(0, content.length - 1)) : previous))
  if (!content.length) return null
  return <section id="cerita" className="landing-story" ref={root} data-active={active} data-reduced={Boolean(reduced)} tabIndex={-1} aria-label="Cerita di bawah permukaan">
    <div className="landing-story-inner">
      <div className="landing-story-stage">
        {/* Progress Indicator: https://21st.dev/@anurag-mishra22/components/progress-indicator */}
        <nav className="story-steps" aria-label="Tahap pengamatan">{content.map((item, index) => <a key={item.label} href={`#story-step-${index}`} aria-current={active === index ? 'step' : undefined} data-complete={index < active}>
          {active === index && <motion.span className="story-step-active" layoutId="story-step-active" transition={{ duration: reduced ? 0 : .3, ease: [.22, 1, .36, 1] }} aria-hidden="true" />}
          <span className="story-step-number">{String(index + 1).padStart(2, '0')}</span><span>{item.label}</span>
        </a>)}</nav>
        <div className="story-progress" aria-hidden="true"><motion.div style={{ scaleX: scrollYProgress }} /></div>
        <div className="story-media" aria-hidden="true">
          <motion.div className="story-root-camera" style={reduced ? undefined : { scale, y }}>
            <PlantIllustration viewBox="0 90 460 400" day={24} onion={false} moisture={85} contact showSensors shellOpacity={shell} sensorOpacity={sensors} />
            <motion.span className="story-surface-line" style={{ opacity: shell }}>Permukaan media</motion.span>
            <motion.div className="story-root-probe" style={{ opacity: probeOpacity }}>
              <span className="story-probe-ring" style={{ left: probe.x }} />
              <span className="story-probe-label">{probe.model}</span>
            </motion.div>
          </motion.div>
          {content.map((item, index) => <motion.div key={item.label} className="story-media-content" data-active={active === index}
            initial={false} animate={{ opacity: active === index ? 1 : 0 }} transition={{ duration: reduced ? 0 : .18 }}>
            {index === 2 ? item.visual : <p className="story-scene-caption">{index ? 'Probe lokal' : 'Pot cabai'} · ilustrasi konsep</p>}
          </motion.div>)}
        </div>
      </div>
      {content.map((item, index) => <article key={item.label} id={`story-step-${index}`} className="landing-chapter" data-active={active === index} style={{ gridRow: index + 1 }} tabIndex={-1}>
        <div className="landing-mobile-scene" aria-hidden="true">{item.visual}</div>
        <p className="landing-eyebrow">{String(index + 1).padStart(2, '0')} / {item.label}</p>
        <h2>{item.title}</h2><p className="landing-chapter-copy">{item.description}</p>{item.body}
      </article>)}
    </div>
  </section>
}
