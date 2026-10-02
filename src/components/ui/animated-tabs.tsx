import { useLayoutEffect, useRef } from 'react'

export interface AnimatedTabsProps { label: string; tabs: string[]; value: number; onChange: (index: number) => void; controls?: string }

// Adapted from preetsuthar17: https://21st.dev/@preetsuthar17/components/animated-tabs
export default function AnimatedTabs({ label, tabs, value, onChange, controls }: AnimatedTabsProps) {
  const root = useRef<HTMLDivElement>(null)
  const mask = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = root.current, overlay = mask.current
    if (!container || !overlay) return
    const measure = () => {
      const selected = container.querySelector<HTMLButtonElement>('button[aria-pressed=true]')
      if (!selected) return
      overlay.style.clipPath = `inset(0 ${container.clientWidth - selected.offsetLeft - selected.offsetWidth}px 0 ${selected.offsetLeft}px round 24px)`
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(container)
    return () => resize.disconnect()
  }, [value])
  return <div className="landing-tabs" ref={root} role="group" aria-label={label} onKeyDown={event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = (value + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
    onChange(next); event.currentTarget.querySelectorAll('button')[next]?.focus()
  }}>
    <div className="landing-tabs-mask" ref={mask} aria-hidden="true">{tabs.map(tab => <span key={tab}>{tab}</span>)}</div>
    {tabs.map((tab, index) => <button key={tab} type="button" aria-pressed={value === index} aria-controls={controls} onClick={() => onChange(index)}>{tab}</button>)}
  </div>
}
