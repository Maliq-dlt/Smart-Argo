import { ArrowLeft, ArrowRight, ArrowUpRight } from '@phosphor-icons/react'
import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

import { motionOk, revealHeadings } from './effects'

/* A row of cards that runs off the right edge, after the "Formats & Availability" row on the Farm Minerals
 * promo. Each card opens a part of the prototype and says plainly how far that part goes. */
const parts = [
  { href: '#simulasi', title: 'Simulator', body: 'Pilih satu dari sepuluh skenario, tanam, majukan waktu, lalu baca sarannya.', status: 'Berjalan di browser', image: './landing/seq/grow/end-d.webp', alt: 'Tanaman cabai berbunga di pot terakota' },
  { href: '#statistik', title: 'Dashboard', body: 'Kondisi pot, langkah berikutnya, dan grafik pengamatan satu sesi.', status: 'Berjalan di browser', image: './landing/seq/rootzone/end-d.webp', alt: 'Perangkat tertancap di samping bibit cabai dalam pot kaca' },
  { href: '#perangkat', title: 'Status perangkat', body: 'Periksa laporan sensor dari berkas sebelum perangkat fisik tersedia.', status: 'Pratinjau berkas', image: './landing/v5/probe-lie.webp', alt: 'Render konsep perangkat Smart Agro yang rebah' },
  { href: '#ekosistem', title: 'Ekosistem', body: 'Akun dan peran, aktivasi, kurasi profil tanaman, energi, dan poin.', status: 'Backend lokal · AI dan blockchain masih rancangan', image: './landing/video/garden-poster.webp', alt: 'Kebun pot di atap rumah saat matahari terbit' },
]

export default function Explore() {
  const root = useRef<HTMLElement>(null), track = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    const host = root.current!
    const ctx = gsap.context(() => {
      if (!motionOk()) return
      revealHeadings(host)
      gsap.from('.v5-card', { x: 80, autoAlpha: 0, duration: 1.1, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: track.current, start: 'top 80%', once: true } })
    }, host)
    return () => ctx.revert()
  }, [])
  const step = (dir: 1 | -1) => {
    const list = track.current!, card = list.querySelector<HTMLElement>('.v5-card')
    list.scrollBy({ left: dir * ((card?.offsetWidth ?? 320) + 14), behavior: motionOk() ? 'smooth' : 'auto' })
  }
  return <section ref={root} id="jelajah" className="v5-explore" tabIndex={-1} aria-labelledby="v5-explore-title">
    <div className="v5-explore-head">
      <h2 id="v5-explore-title" data-split>Jelajahi prototipenya.</h2>
      <p>Label di tiap kartu menyebut apa yang sudah berjalan.</p>
      <div className="v5-explore-nav">
        <button type="button" className="v5-round" onClick={() => step(-1)} aria-label="Kartu sebelumnya"><ArrowLeft aria-hidden="true" /></button>
        <button type="button" className="v5-round" onClick={() => step(1)} aria-label="Kartu berikutnya"><ArrowRight aria-hidden="true" /></button>
      </div>
    </div>
    <ul ref={track} className="v5-explore-track">
      {parts.map(part => <li key={part.href} className="v5-card">
        <a href={part.href}>
          <span className="v5-card-media"><img src={part.image} alt={part.alt} loading="lazy" /></span>
          <span className="v5-card-status">{part.status}</span>
          <span className="v5-card-title">{part.title}<ArrowUpRight aria-hidden="true" /></span>
          <span className="v5-card-body">{part.body}</span>
        </a>
      </li>)}
    </ul>
  </section>
}
