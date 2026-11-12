import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { announceCurtain as announce, markRevealed } from '../lib/curtainSignal'
import './siteCurtain.css'

gsap.registerPlugin(DrawSVGPlugin)

/* Site curtain: the loading screen on first visit and between the landing and the simulator.
 * Large blocks in two rows (the landing's block motif) cover the screen, a sprout draws itself and sways while
 * the page or the simulator chunk loads, then the blocks lift away along a staircase. */

export type CurtainHandle = {
  /** Cover the screen. Resolves once the blocks have closed (immediately if already covered). */
  cover: (label: string, cancellable?: boolean) => Promise<void>
  /** Lift the curtain. Resolves when the page is visible again (immediately if already open). */
  reveal: () => Promise<void>
  covered: () => boolean
}

const COLS = 6, ROWS = 2
const delay = (i: number, lift: boolean) => {
  const col = i % COLS, row = Math.floor(i / COLS)
  // Bottom row leads when closing; the top row leads when lifting.
  return col * .07 + (lift ? row * .1 : (ROWS - 1 - row) * .1)
}

const SiteCurtain = forwardRef<CurtainHandle, { boot: boolean; onCancel: () => void }>(function SiteCurtain({ boot, onCancel }, ref) {
  const root = useRef<HTMLDivElement>(null), sway = useRef<gsap.core.Tween | null>(null), bar = useRef<gsap.core.Tween | null>(null), offer = useRef<gsap.core.Tween | null>(null)
  const state = useRef<'covered' | 'open' | 'moving'>(boot ? 'covered' : 'open')
  const [label, setLabel] = useState('Membaca zona akar…')
  const [cancellable, setCancellable] = useState(false)

  const blocks = () => Array.from(root.current!.querySelectorAll<HTMLElement>('.curtain-blocks i'))
  const body = () => root.current!.querySelector<HTMLElement>('.curtain-body')!

  /** Draws the sprout. On boot the words are already on screen (the static loader in index.html shows them). */
  const drawSprout = (withWords: boolean) => {
    const host = root.current!
    sway.current?.kill(); bar.current?.kill()
    const tl = gsap.timeline()
    tl.fromTo(host.querySelectorAll('.curtain-line'), { drawSVG: '0%' }, { drawSVG: '100%', duration: withWords ? .6 : 1.1, stagger: .12, ease: 'power2.inOut' })
      .fromTo(host.querySelectorAll('.curtain-leaf'), { fillOpacity: 0 }, { fillOpacity: 1, duration: .5, stagger: .1 }, withWords ? .35 : .7)
    if (withWords) tl.fromTo(host.querySelectorAll('.curtain-word, .curtain-label'), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: .6, stagger: .08, ease: 'expo.out' }, .15)
    sway.current = gsap.fromTo(host.querySelector('.curtain-crown'), { rotation: -3 }, { rotation: 3, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, transformOrigin: '50% 100%' })
    // The bar fills toward 90 % while waiting and completes on reveal.
    bar.current = gsap.fromTo(host.querySelector('.curtain-bar i'), { scaleX: 0 }, { scaleX: .9, duration: 4, ease: 'power2.out' })
  }

  useLayoutEffect(() => {
    if (boot) { drawSprout(false); return }
    gsap.set(blocks(), { scaleY: 0 })
    gsap.set(body(), { autoAlpha: 0 })
    root.current!.dataset.state = 'open'
  }, [boot])

  useImperativeHandle(ref, () => ({
    covered: () => state.current === 'covered',
    cover: (text, canCancel = false) => new Promise<void>(resolve => {
      setLabel(text); setCancellable(false)
      if (state.current === 'covered') { resolve(); return }
      state.current = 'moving'
      announce('covered')
      const host = root.current!
      host.dataset.state = 'covering'
      gsap.killTweensOf(blocks())
      // The words wait until the blocks have closed, so they never sit over the page being left.
      gsap.set(body(), { autoAlpha: 0, y: 0 })
      const tl = gsap.timeline({ onComplete: () => { state.current = 'covered'; host.dataset.state = 'covered'; resolve() } })
      blocks().forEach((block, i) => tl.fromTo(block, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: .55, ease: 'power3.inOut' }, delay(i, false)))
      gsap.delayedCall(.62, () => { if (state.current === 'open') return; gsap.set(body(), { autoAlpha: 1 }); drawSprout(true) })
      // Offer a way back only if loading takes a while; this never delays the cover itself.
      offer.current?.kill()
      if (canCancel) offer.current = gsap.delayedCall(1.4, () => setCancellable(true))
    }),
    reveal: () => new Promise<void>(resolve => {
      if (state.current === 'open') { markRevealed(); resolve(); return }
      state.current = 'moving'
      const host = root.current!
      offer.current?.kill()
      setCancellable(false)
      bar.current?.kill()
      const tl = gsap.timeline({ onComplete: () => { sway.current?.kill(); state.current = 'open'; host.dataset.state = 'open'; announce('open'); markRevealed(); resolve() } })
      tl.to(host.querySelector('.curtain-bar i'), { scaleX: 1, duration: .3, ease: 'power2.out' })
        .to(body(), { autoAlpha: 0, y: -18, duration: .45, ease: 'power2.in' }, .15)
      blocks().forEach((block, i) => tl.fromTo(block, { scaleY: 1, transformOrigin: '50% 0%' }, { scaleY: 0, duration: .7, ease: 'power3.inOut' }, .4 + delay(i, true)))
    }),
  }))

  return <div ref={root} className="curtain" data-state={boot ? 'covered' : 'open'}>
    <div className="curtain-blocks" aria-hidden="true">{Array.from({ length: COLS * ROWS }, (_, i) => <i key={i} />)}</div>
    <div className="curtain-body" role="status" aria-live="polite">
      <svg className="curtain-sprout" viewBox="0 0 120 120" aria-hidden="true">
        <path className="curtain-line curtain-ground" d="M18 104C40 98 80 98 102 104" />
        <g className="curtain-crown">
          <path className="curtain-line" d="M60 102C59 86 62 70 60 52" />
          <path className="curtain-line curtain-leaf" d="M60 66C46 68 30 60 26 42C42 40 56 48 60 66Z" />
          <path className="curtain-line curtain-leaf" d="M60 56C62 38 76 26 96 26C96 46 82 58 60 56Z" />
        </g>
      </svg>
      <p className="curtain-word">Smart Agro</p>
      <p className="curtain-label">{label}</p>
      <span className="curtain-bar" aria-hidden="true"><i /></span>
      {cancellable && <button type="button" className="curtain-cancel" onClick={onCancel}>Batal</button>}
    </div>
  </div>
})

export default SiteCurtain
