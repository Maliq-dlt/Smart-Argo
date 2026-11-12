import { useEffect, useRef } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/* Lenis smooth scrolling (lerp 0.1, the same feel as the Farm Minerals promo).
 * Earlier attempts felt smooth only some of the time. The usual causes are avoided here:
 *  - one instance per mount, destroyed on unmount (React StrictMode mounts twice in development);
 *  - Lenis is advanced by the GSAP ticker, so there is a single animation loop and ScrollTrigger reads
 *    the same scroll position on the same frame;
 *  - jumps go through lenis.scrollTo, never window.scrollTo, which would fight the interpolation;
 *  - touch keeps native scrolling, and reduced motion turns Lenis off entirely. */
export function useLenis(enabled: boolean) {
  const lenis = useRef<Lenis | null>(null)
  useEffect(() => {
    if (!enabled) return
    const instance = new Lenis({ lerp: .1, wheelMultiplier: 1, autoRaf: false })
    lenis.current = instance
    const tick = (time: number) => instance.raf(time * 1000)
    instance.on('scroll', ScrollTrigger.update)
    // No scrolling behind the loading curtain.
    const onCurtain = (event: Event) => ((event as CustomEvent).detail === 'covered' ? instance.stop() : instance.start())
    if (document.querySelector('.curtain')?.getAttribute('data-state') === 'covered') instance.stop()
    window.addEventListener('smartagro:curtain', onCurtain)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      window.removeEventListener('smartagro:curtain', onCurtain)
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      instance.destroy()
      lenis.current = null
    }
  }, [enabled])
  return lenis
}
