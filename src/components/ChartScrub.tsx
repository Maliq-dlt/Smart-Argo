import { useState, type PointerEvent } from 'react'

export type ScrubPoint = { x: number; y: number; text: string }

/** A chart's reading dot (2026-11-24): it rests on the newest point, follows the pointer (or a finger while it touches)
 *  to the nearest point with its value beside it, and glides back to the newest point when the pointer leaves or the
 *  finger lifts, like a stocks chart. `pick` is the point being read, null at rest. Positions are in viewBox units. */
export function useScrub(points: ScrubPoint[], viewWidth: number) {
  const [pick, setPick] = useState<number | null>(null)
  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width * viewWidth
    let best = 0
    points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(points[best].x - x)) best = i })
    return best
  }
  const touch = (event: PointerEvent) => event.pointerType !== 'mouse'
  const handlers = points.length < 2 ? {} : {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => setPick(nearest(event)),
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => { if (!touch(event) || event.buttons) setPick(nearest(event)) },
    onPointerLeave: (event: PointerEvent<SVGSVGElement>) => { if (!touch(event)) setPick(null) },
    onPointerUp: (event: PointerEvent<SVGSVGElement>) => { if (touch(event)) setPick(null) },
    onPointerCancel: () => setPick(null),
  }
  return { pick, setPick, handlers }
}

/** The dot and its guide line, inside the chart's <svg>. They move by CSS transition: briefly while following, a little
 *  longer on the way back, never past the point (no spring). */
export function ScrubMarker({ point, reading, top, bottom }: { point: ScrubPoint; reading: boolean; top: number; bottom: number }) {
  return <g className="scrub" data-reading={reading || undefined} style={{ transform: `translateX(${point.x}px)` }} aria-hidden="true">
    <line className="scrub-line" x1={0} x2={0} y1={top} y2={bottom} />
    <circle className="scrub-dot" cx={0} cy={0} r={5.5} style={{ transform: `translateY(${point.y}px)` }} />
  </g>
}

/** The value beside the dot, as HTML over the chart, placed in percent of the viewBox so it stays on the dot at any
 *  text size, and fading out at rest. Its anchor slides with the dot (left edge at the chart's left, right edge at the
 *  right), so it never leaves the chart, even with large text on a small phone. */
export function ScrubTip({ point, reading, viewWidth, viewHeight }: { point: ScrubPoint; reading: boolean; viewWidth: number; viewHeight: number }) {
  const at = Math.min(1, Math.max(0, point.x / viewWidth))
  return <div className="scrub-tip" data-reading={reading || undefined} aria-hidden="true"
    style={{ left: `${at * 100}%`, top: `${point.y / viewHeight * 100}%`, translate: `${-at * 100}% calc(-100% - .75rem)` }}>{point.text}</div>
}
