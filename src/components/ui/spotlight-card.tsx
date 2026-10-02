import type { HTMLAttributes } from 'react'

export type SpotlightCardProps = HTMLAttributes<HTMLDivElement>

// Adapted from jahed: https://21st.dev/@jahed/components/spotlight-card
// ponytail: local border glow only; add motion only when cards need coordinated transitions.
export default function SpotlightCard({ className = '', onPointerMove, ...props }: SpotlightCardProps) {
  return <div {...props} className={`spotlight-card ${className}`} onPointerMove={event => {
    onPointerMove?.(event)
    if (event.pointerType !== 'mouse') return
    const { left, top } = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--spotlight-x', `${event.clientX - left}px`)
    event.currentTarget.style.setProperty('--spotlight-y', `${event.clientY - top}px`)
  }} />
}
