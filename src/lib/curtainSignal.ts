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
