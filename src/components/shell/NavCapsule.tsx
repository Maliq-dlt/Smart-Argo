import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { Icon } from '@phosphor-icons/react'
import AgroMark from '../AgroMark'

export interface NavTab { id: string; hash: string; label: string; icon: Icon }

/** The one floating, glass element: the app's sections. A lens slides to the current one (position, not decoration);
 *  the page itself swaps at once. On a phone the capsule sits at the bottom edge, like the Android tab bar. */
export default function NavCapsule({ tabs, active, children }: { tabs: NavTab[]; active: string; children?: ReactNode }) {
  return <nav className="nav-capsule" aria-label="Navigasi utama">
    <a className="nav-mark" href="#" aria-label="Smart Agro · Beranda"><AgroMark /></a>
    <div className="nav-tabs">
      {tabs.map(({ id, hash, label, icon: Icon }) => <a key={id} href={hash} className="nav-tab" aria-current={active === id ? 'page' : undefined}
        onClick={() => { if (active === id) window.scrollTo({ top: 0, behavior: 'instant' }) }}>
        {/* A tween, not a spring: the lens arrives without overshoot, so quick back-and-forth never wobbles. */}
        {active === id && <motion.span className="nav-lens" layoutId="nav-lens" transition={{ type: 'tween', duration: .32, ease: [.2, .7, .2, 1] }} aria-hidden="true" />}
        <Icon weight={active === id ? 'fill' : 'regular'} aria-hidden="true" /><span className="nav-label">{label}</span>
      </a>)}
    </div>
    {children && <div className="nav-tools">{children}</div>}
  </nav>
}
