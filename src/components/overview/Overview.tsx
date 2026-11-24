import { useMemo, useState, type MouseEvent } from 'react'
import { CheckCircle, Drop, MagnifyingGlass, Package, Plus, Sparkle, Thermometer, Warning, type Icon } from '@phosphor-icons/react'
import PlantScene from '../PlantScene'
import { sceneOf } from '../../lib/species'
import { bandSourceLabel, outlookLabel, arrange, headline, summaryLine, wateringWindow, type OverviewPlant, type Tone } from '../../lib/overview'
import './overview.css'

const TONE_ICON: Record<Tone, Icon> = { ok: CheckCircle, soon: Drop, dry: Drop, wet: Drop, hot: Thermometer, check: Warning, learn: Sparkle, idle: Sparkle }
const n = (v: number) => v.toLocaleString('id-ID')
// The engine's moisture index carries decimals; a summary rounds it (the plant page keeps the exact value).
const m0 = (v: number) => Math.round(v).toLocaleString('id-ID')
const hours = (h: number) => h < 1 ? 'kurang dari 1 jam' : `${n(h)} jam`

function Status({ plant }: { plant: OverviewPlant }) {
  const Glyph = TONE_ICON[plant.status.tone]
  return <span className="ov-status" data-tone={plant.status.tone}><Glyph weight={plant.status.tone === 'ok' ? 'fill' : 'regular'} aria-hidden="true" />{plant.status.word}</span>
}
function nextWater(p: OverviewPlant) {
  if (p.live) return outlookLabel(p.outlook)
  const w = wateringWindow(p)
  if (!w) return p.status.tone === 'learn' ? 'Pola pot ini masih dipelajari' : p.planted ? 'Belum perlu disiram dalam 24 jam' : 'Tanam untuk mulai mengamati'
  return w.to === 0 ? 'Siram sekarang' : `Siram dalam ${hours(w.from)}–${hours(w.to)}`
}
/** The pot as a measuring cup: the soil line sits at the moisture index; ochre below the healthy band, blue otherwise. */
function MiniPot({ plant }: { plant: OverviewPlant }) {
  const m = plant.moisture ?? 0, top = 24 - 14 * Math.min(100, Math.max(0, m)) / 100, xl = (y: number) => 6 + (y - 9) * 2 / 15, xr = (y: number) => 22 - (y - 9) * 2 / 15
  return <svg className="ov-minipot" viewBox="0 0 28 28" aria-hidden="true">
    <path d="M6 9h16l-2 15H8z" className="pot-fill" />
    {plant.moisture !== null && <path d={`M${xl(top).toFixed(2)} ${top.toFixed(2)}H${xr(top).toFixed(2)}L20 24H8z`} className="pot-soil" data-dry={plant.status.tone === 'dry' || undefined} />}
    <path d="M6 9h16l-2 15H8z" className="pot-line" /><path d="M5 9h18" className="pot-rim" />
  </svg>
}

/** Ringkasan: the state of every plant in one sentence, the ones that need you as large cards, the rest as tiles,
 *  what is due within a day, and the products. Server and simulator supply their own data. */
export default function Overview({ plants, products, onOpen, onAdd, onDemo }: {
  plants: OverviewPlant[]; products: number | null
  onOpen: (plant: OverviewPlant, art: HTMLElement | null) => void; onAdd?: () => void
  /** A guest with an empty garden can load the example here too, not only from the pot picker's small menu. */
  onDemo?: () => void
}) {
  const places = useMemo(() => [...new Set(plants.map(p => p.place).filter((p): p is string => !!p))], [plants])
  const [place, setPlace] = useState<string | null>(null), [query, setQuery] = useState('')
  const shown = plants.filter(p => (!place || p.place === place) && (!query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())))
  const { mode, featured, rest } = arrange(shown)
  const open = (plant: OverviewPlant) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
    event.preventDefault(); onOpen(plant, event.currentTarget.querySelector<HTMLElement>('.ov-art'))
  }
  const due = plants.map(p => ({ p, w: wateringWindow(p) })).filter((x): x is { p: OverviewPlant; w: { from: number; to: number } } => !!x.w).sort((a, b) => a.w.from - b.w.from)
  const x = (h: number) => `${Math.min(100, h / 24 * 100)}%`
  const summary = summaryLine(plants)

  return <div className="overview">
    <header className="ov-head">
      <h1 className="ov-title">{headline(plants)}</h1>
      {summary && <p className="ov-sub">{summary}</p>}
    </header>

    <section className="ov-plants" aria-labelledby="ov-plants-title">
      <div className="ov-section-head">
        <h2 id="ov-plants-title">Tanaman <span className="ov-count">{plants.length}</span></h2>
        <div className="ov-tools">
          {plants.length > 8 && <label className="ov-search"><MagnifyingGlass aria-hidden="true" /><span className="sr-only">Cari tanaman</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari tanaman" /></label>}
          {onDemo && <button type="button" className="button" onClick={onDemo}>Muat contoh kebun</button>}
          {onAdd && <button type="button" className="button" onClick={onAdd}><Plus aria-hidden="true" />Tambah</button>}
        </div>
      </div>
      {plants.length > 4 && places.length > 1 && <div className="ov-chips" role="group" aria-label="Tempat">
        {[null, ...places].map(pl => <button key={pl ?? 'all'} type="button" className="ov-chip" aria-pressed={place === pl} onClick={() => setPlace(pl)}>{pl ?? 'Semua'}</button>)}
      </div>}

      {featured.length > 0 && <>
        {mode !== 'single' && <h3 className="ov-group">{mode === 'attention' ? 'Perlu perhatian' : 'Berikutnya'}</h3>}
        <div className={`ov-featured ${featured.length === 1 ? 'single' : ''}`}>
          {featured.map(p => <a key={p.id} href="#tanaman" className="ov-card" data-tone={p.status.tone} data-species={p.species} onClick={open(p)}
            aria-label={`${p.name}, ${p.status.word}${p.moisture !== null ? `, kelembapan ${m0(p.moisture)}` : ''}`}>
            <span className="ov-art"><PlantScene species={sceneOf(p.species)} day={p.day} planted={p.planted} moisture={p.moisture ?? 0} contact={p.moisture !== null} hour={p.hour} label={`${p.live ? 'Ilustrasi pot' : 'Penampang pot'} ${p.name}`} /></span>
            <span className="ov-info">
              <span className="ov-name">{p.name}</span>
              {(p.place || p.tag) && <span className="ov-place">{[p.place, p.tag].filter(Boolean).join(' · ')}</span>}
              <Status plant={p} />
              {p.live && <span className="ov-note">{bandSourceLabel(p.bandSource ?? null)}</span>}
              <span className="ov-meta">{p.moisture !== null && <>Kelembapan <b>{m0(p.moisture)}</b><span aria-hidden="true"> · </span></>}{nextWater(p)}</span>
            </span>
          </a>)}
        </div>
      </>}

      {rest.length > 0 && <>
        <h3 className="ov-group">{featured.length ? 'Tanaman lain' : 'Semua tanaman'}</h3>
        <div className="ov-tiles">
          {rest.map(p => <a key={p.id} href="#tanaman" className="ov-tile" data-tone={p.status.tone} onClick={open(p)}>
            <MiniPot plant={p} />
            <span className="ov-tile-text"><span className="ov-tile-name">{p.name}</span><Status plant={p} /></span>
            {p.moisture !== null && <span className="ov-tile-value" aria-label={`kelembapan ${m0(p.moisture)}`}>{m0(p.moisture)}</span>}
          </a>)}
        </div>
      </>}
      {shown.length === 0 && <p className="ov-empty">Tidak ada tanaman yang cocok.</p>}
    </section>

    <div className="ov-pair">
      <section className="panel ov-due" aria-labelledby="ov-due-title">
        <h2 id="ov-due-title">Siram dalam 24 jam</h2>
        <p className="ov-note">Garis tegak = sekarang. Pita = perkiraan, dari laju kering tiap pot.</p>
        {due.length ? <div className="ov-due-rows">
          {due.map(({ p, w }) => <div key={p.id} className="ov-due-row">
            <span className="ov-due-name">{p.name}<small>{w.to === 0 ? 'Sekarang' : `${hours(w.from)}–${hours(w.to)} lagi`}</small></span>
            <span className="ov-ruler" role="img" aria-label={`${p.name}: ${w.to === 0 ? 'siram sekarang' : `siram dalam ${hours(w.from)} sampai ${hours(w.to)}`}`}>
              {Array.from({ length: 25 }, (_, h) => <i key={h} className={h % 6 === 0 ? 'major' : ''} style={{ left: x(h) }} />)}
              {w.to === 0 ? <b className="ov-now-dot" /> : <b className="ov-window" style={{ left: x(w.from), width: `calc(${x(w.to)} - ${x(w.from)})` }} />}
            </span>
          </div>)}
          <div className="ov-due-scale" aria-hidden="true"><span /><span><em>Sekarang</em><em>+6</em><em>+12</em><em>+18</em><em>+24 jam</em></span></div>
        </div> : <p className="ov-empty">Belum ada perkiraan siram dalam 24 jam.</p>}
      </section>
      {products !== null && <section className="panel ov-products" aria-labelledby="ov-products-title">
        <h2 id="ov-products-title">Produk</h2>
        <p className="ov-big"><b>{n(products)}</b> {products === 1 ? 'perangkat terhubung' : 'perangkat terhubung'}</p>
        <p className="ov-note">Baterai, jeda kiriman, dan panel surya tiap perangkat ada di halaman tanamannya.</p>
        <a className="button" href="#ekosistem"><Package aria-hidden="true" />Kelola produk</a>
      </section>}
    </div>
  </div>
}
