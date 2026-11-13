import type { MouseEvent, ReactNode } from 'react'
import { ArrowUpRight, ShieldCheck, Warning } from '@phosphor-icons/react'

export interface CareTile { icon: ReactNode; label: string; value: string }

/** The engine's advice, its reason and four supporting facts. The corner arrow opens the care controls. */
export default function CareCard({ tone, action, reason, tiles, openLabel, onOpen }: {
  tone: 'calm' | 'care' | 'blocked'; action: string; reason: string; tiles: CareTile[]; openLabel: string
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return <section className={`panel dashboard-care tone-${tone}`} aria-labelledby="care-title">
    <header>
      <span className="care-badge">{tone === 'calm' ? <ShieldCheck weight="duotone" aria-hidden="true" /> : <Warning weight="duotone" aria-hidden="true" />}
        <h2 id="care-title">{tone === 'blocked' ? 'Periksa sebelum merawat' : 'Catatan perawatan'}</h2></span>
    </header>
    <h3>{action}</h3>
    <p>{reason}</p>
    <ul className="care-tiles">{tiles.map(tile => <li key={tile.label}>{tile.icon}<span>{tile.label}</span><strong>{tile.value}</strong></li>)}</ul>
    <a className="care-open" href="#simulasi" aria-label={openLabel} title={openLabel} onClick={onOpen}><ArrowUpRight aria-hidden="true" /></a>
  </section>
}
