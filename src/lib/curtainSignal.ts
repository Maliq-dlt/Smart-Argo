/* Shared state for the site curtain (the loading screen), kept outside the component so the landing can
 * wait for it and the curtain file only exports components. */
let revealed = false
const waiting: (() => void)[] = []

/** Resolves after the first curtain lift, so entrance animations are not spent behind it. */
export const whenRevealed = () => new Promise<void>(resolve => { if (revealed) resolve(); else waiting.push(resolve) })

/** Marks the page as visible; also used when the curtain is skipped for reduced motion. */
export const markRevealed = () => { revealed = true; waiting.splice(0).forEach(fn => fn()) }

/** Lets the landing pause smooth scrolling while the curtain is closed. */
export const announceCurtain = (state: 'covered' | 'open') => window.dispatchEvent(new CustomEvent('smartagro:curtain', { detail: state }))

/** The site curtain's cover and lift, registered by the site while the curtain exists (not with reduced motion). */
type Curtain = { cover: (label: string) => Promise<void>; reveal: () => Promise<void> }
let curtain: Curtain | null = null, running = false
export const registerCurtain = (handle: Curtain | null) => { curtain = handle }
/** True while a page change run by `behindCurtain` owns the curtain; the site's own route handling must not lift it. */
export const curtainHeld = () => running
// Two frames for the new page to paint; the timer keeps a hidden tab (no frames) from leaving the screen covered.
const settle = () => new Promise<void>(done => { const timer = setTimeout(done, 120); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); done() })) })
/** Runs `swap` (a change of page inside the app, such as entering it) behind the loading screen. Without a curtain
 * (reduced motion) it just runs; a second call while one is running is ignored. */
export async function behindCurtain(label: string, swap: () => void | Promise<void>) {
  if (running) return
  if (!curtain) { await swap(); return }
  running = true
  try {
    await curtain.cover(label)
    await swap()
    await settle()
  } finally {
    running = false
    await curtain.reveal()
  }
}
