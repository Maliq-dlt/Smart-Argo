import { useEffect, useRef, useState } from 'react'

/** The width of an element, kept current. SVG charts use it as their viewBox, so their text stays its real size at every width. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    // ResizeObserver reports the first size as soon as it starts observing.
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
