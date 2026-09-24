import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Lenis from 'lenis'
import { Activity, ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, BookOpen, Check, ChevronRight, Clock3, Droplets, FlaskConical, Leaf, Pause, Play, RotateCcw, Settings2, Save, History, ShieldCheck, Sprout, Thermometer, TriangleAlert, Sun, Moon, X, LayoutDashboard, GitCompareArrows, Terminal, Radio, Menu } from 'lucide-react'
import { addSample, evaluate, parseCase, phaseAt, recordWatering, type PotCase, type Profile } from './lib/agronomyEngine'
import scenarios from './lib/scenarios.json'
import PlantPotVisualizer from './components/PlantPotVisualizer'
import SensorControls from './components/SensorControls'
import StatisticsDashboard from './components/StatisticsDashboard'
import TerminalSimulator from './components/TerminalSimulator'
import SessionComparison, { SessionLibrary } from './components/SessionPanel'
import { appendSession, createSession, exportSession as encodeSession, importSession as decodeSession, readBook, saveBook, sessionTime, STORAGE_KEY, type Session, type SessionBook, type LogEntry } from './lib/sessionStore'
import ProfileEditor from './components/ProfileEditor'
import ClockSettings from './components/ClockSettings'
import DevicePanel from './components/DevicePanel'
import { clockDate, clockTime, utcLabel } from './lib/sessionClock'
import { deviceStatuses, type DeviceSnapshot } from './lib/telemetry'
import SimulationControls from './components/SimulationControls'
import SimulationOverview from './components/SimulationOverview'
import { createJourney, simulationOf, advanceSimulation, plantSeed, waterSimulation, recordFertilizer, feedingDue, shouldPause, simulationStopped, simulationStopReason, sampleIntervalMs, logEvent, type SimulationState } from './lib/simulation'

const loadScenario = (index: number) => {
  const session = createSession(scenarios[index], scenarios[index].name, String(index), index === 7 ? 25 : 42)
  return { ...session, simulation: { ...simulationOf(session), source: 'auto' as const, rate: 12 } }
}
function restoreSessions() {
  const initial = createJourney(loadScenario(0).data)
  const fallback: SessionBook = { version: 1, activeId: initial.id, sessions: [initial] }
  try {
    const saved = readBook(window.localStorage)
    return { book: saved.book ?? fallback, raw: saved.raw, error: '', restored: saved.book !== null }
  } catch {
    return { book: fallback, raw: null, error: 'Simpanan lokal tidak dapat dibaca. Data lama tidak ditimpa; gunakan ekspor untuk mencadangkan eksplorasi ini.', restored: false }
  }
}
const downloadJson = (value: unknown, filename: string) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [boot] = useState(restoreSessions)
  const [book, setBook] = useState<SessionBook>(boot.book)
  const session = book.sessions.find(s => s.id === book.activeId)!
  const currentSession = useRef(session)
  useLayoutEffect(() => { currentSession.current = session }, [session])
  const { data, scenario, reading, day, speed, logs } = session
  const persistedRaw = useRef(boot.raw)
  const [saveState, setSaveState] = useState<{ book: SessionBook | null; error: string; time: number }>({ book: null, error: boot.error, time: 0 })
  const [playing, setPlaying] = useState(false), [running, setRunning] = useState(false)
  const [pauseNote, setPauseNote] = useState(boot.restored ? 'Sesi dipulihkan dalam keadaan dijeda. Tekan Lanjutkan waktu.' : '')
  const [page, setPage] = useState(location.hash === '#statistik' ? 'statistics' : 'simulation')
  const [menuOpen, setMenuOpen] = useState(false)
  const [panelToOpen, setPanelToOpen] = useState('')
  const reducedMotion = useReducedMotion()
  const smooth = useRef<Lenis | null>(null), previousPage = useRef(page)
  const scrollTo = useCallback((target: HTMLElement | number) => {
    if (typeof target !== 'number') target.focus({ preventScroll: true })
    if (smooth.current) { smooth.current.resize(); smooth.current.scrollTo(target, { offset: typeof target === 'number' ? 0 : -20, duration: .65 }) }
    else window.scrollTo({ top: typeof target === 'number' ? target : scrollY + target.getBoundingClientRect().top - 20 })
  }, [])
  useEffect(() => {
    const lenis = new Lenis({ autoRaf: true, autoToggle: true, duration: .8, anchors: false,
      prevent: node => Boolean(node.closest('dialog, .terminal-content, .log-lines')) })
    smooth.current = lenis
    return () => { lenis.destroy(); smooth.current = null }
  }, [])
  const [theme, setTheme] = useState(() => {
    try { const saved = localStorage.getItem('smart-agro.theme'); if (saved === 'light' || saved === 'dark') return saved } catch { /* Theme still works when storage is unavailable. */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const sim = simulationOf(session), journey = sim.mode === 'journey'
  const developmentDay = journey ? Math.floor(sim.growthHours / 24) : session.day
  const [notice, setNotice] = useState(boot.restored ? 'Sesi terakhir dipulihkan. Ilustrasi dijeda; jam sensor tetap tersimpan.' : '')
  const [error, setError] = useState(''), [profileVersion, setProfileVersion] = useState(0)
  const profileDialog = useRef<HTMLDialogElement>(null), guideDialog = useRef<HTMLDialogElement>(null), sessionsDialog = useRef<HTMLDialogElement>(null), importFile = useRef<HTMLInputElement>(null)
  const result = evaluate(data), last = data.samples.at(-1)!
  const onion = data.profile.crop.toLowerCase().includes('bawang'), maxDay = onion ? 65 : 90
  const phase = phaseAt(day, onion), phRow = [...data.samples].reverse().find(r => r.valid && r.ph !== null)
  const phFresh = phRow && data.now_h - phRow.t_h <= 24 && data.profile.ph_validated
  const ageMinutes = Math.round((data.now_h - last.t_h) * 60)
  const dataGood = last.valid && data.now_h - last.t_h <= 5 / 60 && result.decision !== 'PERIKSA_SENSOR'
  const blocked = ['KALIBRASI_LOKAL', 'PULIHKAN_DATA', 'PERIKSA_SENSOR'].includes(result.decision)
  const calm = result.decision === 'AMATI'
  const playbackNote = running ? '' : simulationStopReason(session) || pauseNote
  function toggleRunning() { setPauseNote(running ? 'Dijeda oleh pengguna.' : ''); setRunning(!running) }

  useEffect(() => {
    const navigate = () => { setPage(location.hash === '#statistik' ? 'statistics' : 'simulation'); setMenuOpen(false) }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    const changed = previousPage.current !== page
    previousPage.current = page
    if (page === 'statistics' && panelToOpen) {
      const panel = document.querySelector<HTMLDetailsElement>(`.${panelToOpen}`)
      if (panel) {
        const opening = !panel.open
        panel.open = true
        const summary = panel.querySelector('summary')
        summary?.focus({ preventScroll: true })
        // Lenis must measure the expanded page before clamping its destination.
        const duration = opening ? parseFloat(getComputedStyle(panel, '::details-content').transitionDuration) * 1000 : 0
        const timer = setTimeout(() => { if (panel.open && summary) scrollTo(summary); setPanelToOpen('') }, duration)
        return () => clearTimeout(timer)
      }
      setPanelToOpen('')
    } else if (changed) {
      setPanelToOpen('')
      document.getElementById('main')?.focus({ preventScroll: true }); scrollTo(0)
    }
  }, [page, panelToOpen, scrollTo])
  function openStatisticsPanel(panel: string) {
    location.hash = 'statistik'; setPage('statistics'); setPanelToOpen(panel); setMenuOpen(false)
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('smart-agro.theme', theme) } catch { /* Keep theme usable for this visit. */ }
  }, [theme])
  useEffect(() => {
    const pause = () => { if (document.hidden) { setRunning(false); setPlaying(false); setPauseNote('Dijeda saat tab tidak aktif. Tekan Lanjutkan waktu.') } }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [])
  useEffect(() => {
    if (!running) return
    // Keep the cadence independent of illustration, autosave, and form updates.
    const timer = setInterval(() => {
      const previous = currentSession.current
      if (previous.id !== session.id) return
      try {
        let next = advanceSimulation(previous, 1)
        if (shouldPause(next, previous)) {
          const reason = simulationStopReason(next) || (feedingDue(next) && !feedingDue(previous) ? 'Jeda otomatis: pengingat jadwal pupuk tiba.' : `Jeda otomatis: ${evaluate(next.data).action}`)
          next = logEvent(next, reason, 'system'); setPauseNote(reason); setRunning(false)
        }
        // A queued edit wins over this tick; never replace newer user data.
        setBook(old => ({ ...old, sessions: old.sessions.map(s => s === previous ? next : s) }))
      } catch (err) { setRunning(false); setError(err instanceof Error ? err.message : 'Simulasi gagal dilanjutkan.') }
    }, sampleIntervalMs(sim.rate))
    return () => clearInterval(timer)
  }, [running, session.id, sim.rate])

  const persist = useCallback(() => {
    if (boot.error) return
    try {
      persistedRaw.current = saveBook(window.localStorage, book, persistedRaw.current)
      setSaveState({ book, error: '', time: Date.now() })
    } catch (err) {
      const message = err instanceof Error && err.name !== 'QuotaExceededError' ? err.message : 'Penyimpanan penuh atau tidak tersedia. Ekspor sesi sebagai cadangan; simpanan lama tetap utuh.'
      setSaveState({ book: null, error: message, time: 0 })
    }
  }, [book, boot.error])
  useEffect(() => { persist() }, [persist])
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') persist() }
    window.addEventListener('pagehide', persist); document.addEventListener('visibilitychange', hide)
    return () => { window.removeEventListener('pagehide', persist); document.removeEventListener('visibilitychange', hide) }
  }, [persist])
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if ((e.key === STORAGE_KEY || e.key === null) && e.newValue !== persistedRaw.current)
        setSaveState({ book: null, error: 'Simpanan berubah di tab lain. Ekspor perubahan tab ini, lalu muat ulang sebelum melanjutkan penyimpanan.', time: 0 })
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setBook(old => ({ ...old, sessions: old.sessions.map(s => s.id === old.activeId ? { ...s, day: Math.min(maxDay, s.day + 1), updatedAt: Date.now() } : s) })), 650 / speed)
    return () => clearInterval(timer)
  }, [playing, speed, maxDay])
  useEffect(() => { if (day >= maxDay) setPlaying(false) }, [day, maxDay])
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timer) } }, [notice])

  function edit(change: Partial<Session> | ((s: Session) => Session)) {
    setBook(old => ({ ...old, sessions: old.sessions.map(s => s.id === old.activeId ? { ...(typeof change === 'function' ? change(s) : { ...s, ...change }), updatedAt: Date.now() } : s) }))
  }
  const setDay = (value: number) => edit({ day: value })
  const setSpeed = (value: number) => edit({ speed: value })
  function commit(next: PotCase, message: string, kind: LogEntry['kind'] = 'action') {
    const checked = parseCase(next), output = evaluate(checked)
    edit(s => ({ ...s, data: checked, scenario: 'custom', freshPh: kind === 'data' ? false : s.freshPh,
      logs: [...s.logs, { id: (s.logs.at(-1)?.id ?? 0) + 1, time: sessionTime(next.now_h), kind, message },
        { id: (s.logs.at(-1)?.id ?? 0) + 2, time: sessionTime(next.now_h), kind: 'rule' as const, message: output.decision }].slice(-500) }))
    setError('')
  }
  function openNew(next: Session) {
    setBook(old => appendSession(old, next)); setPlaying(false); setRunning(false); setPauseNote(''); setError('')
  }
  function reset(index: number) {
    openNew(loadScenario(index))
    setNotice('Sesi baru dibuka. Eksplorasi sebelumnya tersedia di Lanjutkan sesi.')
  }
  function resume(id: string) {
    const selected = book.sessions.find(s => s.id === id)
    if (!selected) return
    const stopped = simulationStopReason(selected)
    setBook(old => ({ ...old, activeId: id })); setPlaying(false); setRunning(!stopped); setPauseNote(stopped); setError(''); sessionsDialog.current?.close()
    setNotice(stopped || 'Sesi dilanjutkan. Waktu otomatis berjalan.')
  }
  function changeMode(mode: SimulationState['mode']) {
    const previous = [...book.sessions].reverse().find(s => simulationOf(s).mode === mode)
    if (previous) resume(previous.id)
    else openNew(mode === 'journey' ? createJourney(loadScenario(onion ? 7 : 0).data) : loadScenario(onion ? 7 : 0))
    location.hash = 'simulasi'
  }
  function configureSimulation(change: Partial<SimulationState>) {
    if (change.source) { setRunning(false); setPauseNote('Sumber sampel diubah. Tekan Lanjutkan waktu.') }
    if (change.pauseOnCare !== undefined) setPauseNote('')
    edit(s => ({ ...s, simulation: { ...simulationOf(s), ...change } }))
  }
  function advance(steps: number) {
    try { const next = advanceSimulation(session, steps); edit(next); setPauseNote(shouldPause(next, session) ? simulationStopReason(next) || (feedingDue(next) && !feedingDue(session) ? 'Jeda otomatis: pengingat jadwal pupuk tiba.' : `Jeda otomatis: ${evaluate(next.data).action}`) : '') }
    catch (err) { setError(err instanceof Error ? err.message : 'Simulasi gagal dilanjutkan.') }
  }
  function snapshot() {
    const next = { ...structuredClone(session), id: crypto.randomUUID(), name: session.name.slice(0, 109) + ' · salinan', updatedAt: Date.now() }
    setBook(old => appendSession(old, next, false))
    return next.id
  }
  function fault(kind: 'stale' | 'invalid' | 'jump' | 'media') {
    try {
      if (kind === 'stale') commit({ ...data, now_h: data.now_h + 10 / 60 }, 'Waktu sesi maju 10 menit tanpa pembacaan.')
      if (kind === 'invalid') commit(addSample(data, { ...reading, ph: null, valid: false }, 1), 'Pembacaan gagal / CRC tidak valid. Nilai bukan data baru yang sah.')
      if (kind === 'jump') commit(addSample(data, { ...reading, moisture: last.moisture > 50 ? 9 : 95, ph: null, valid: true }, 1), 'Lonjakan sintetis dalam 1 menit tanpa tindakan siram.')
      if (kind === 'media') { commit({ ...data, media_changed: true }, 'Media diganti; acuan lokal harus ditetapkan ulang.'); setNotice('Acuan dibatalkan. Buka Acuan lokal untuk memulai sesi media baru.') }
    } catch (err) { setError(err instanceof Error ? err.message : 'Masukan gagal') }
  }
  function applyProfile(profile: Profile) {
    const mediaChanged = data.media_changed || profile.media !== data.profile.media
    const next = parseCase(mediaChanged ? { profile, now_h: 0, samples: [{ ...reading, t_h: 0, ph: null, valid: true }] } : { ...data, profile, media_changed: false })
    if (mediaChanged) openNew(journey ? createJourney(next) : createSession(next, `${profile.crop} · ${profile.media}`))
    else commit(next, 'Profil acuan diperbarui.')
    profileDialog.current?.close(); setNotice(mediaChanged ? 'Sesi media baru dibuka. Riwayat sebelumnya tetap tersedia.' : 'Acuan lokal diterapkan.')
  }
  function exportSession() {
    downloadJson(encodeSession(session), `agro-P1-${Date.now()}.json`)
    setNotice('Sesi diekspor, termasuk riwayat, draf, ilustrasi, dan log.')
  }
  async function importSession(file?: File) {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('File maksimum 2 MB.')
      const raw: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/, ''))
      openNew(decodeSession(raw, file.name.replace(/\.json$/i, '') || 'Sesi impor'))
      setNotice('Sesi impor dibuka. Sesi sebelumnya tetap tersedia.')
    } catch (err) { setError(err instanceof Error ? err.message : 'File JSON tidak dapat dibaca') }
    if (importFile.current) importFile.current.value = ''
  }
  function importDevice(snapshot: DeviceSnapshot) {
    edit(s => {
      let next = logEvent({ ...s, deviceSnapshot: snapshot }, `Pratinjau berkas ${snapshot.packet.device_id} / ${snapshot.packet.sample_id}. Waktu ukur UTC ${snapshot.packet.measured_at}; tidak dimasukkan ke riwayat sensor simulasi.`, 'system')
      for (const row of deviceStatuses(snapshot.packet, snapshot.importedAt)) {
        if (row.severity !== 'ok') next = logEvent(next, `Pratinjau perangkat — ${row.label}: ${row.message}`, row.severity === 'error' ? 'fault' : 'system')
      }
      return next
    })
  }
  const recommendation = <section className={`care-recommendation ${calm ? 'calm' : blocked ? 'blocked' : ''}`} aria-labelledby="decision-heading">
    <div className="decision-eyebrow">{calm ? <ShieldCheck /> : <TriangleAlert />}<h2 id="decision-heading">{blocked ? 'Periksa sebelum merawat' : 'Catatan perawatan'}</h2></div>
    <h3>{journey && !sim.planted ? 'Bibit siap memulai perjalanan' : result.action}</h3><p>{journey && !sim.planted ? 'Tanam untuk memulai waktu, lalu amati perubahan media dan perkembangan tanaman.' : result.reason}</p>
    {result.evidence.eta_h !== null && <span className="care-eta"><Clock3 />Menuju acuan air: {result.evidence.eta_h} jam</span>}
  </section>
  return <>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Lewati ke konten</a>
    <div className="app-shell">
    <aside className="app-sidebar">
      <a className="brand" href="#statistik" aria-label="Smart Agro · Dashboard"><span className="brand-mark"><Sprout /></span><span>smart<span className="brand-light">agro</span></span></a>
      <button className="icon-button mobile-menu" aria-label={menuOpen ? 'Tutup navigasi' : 'Buka navigasi'} aria-expanded={menuOpen} aria-controls="sidebar-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      <div id="sidebar-navigation" className={`sidebar-content ${menuOpen ? 'is-open' : ''}`} onKeyDown={e => { if (e.key === 'Escape') { setMenuOpen(false); document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus() } }}>
        <nav className="sidebar-nav" aria-label="Navigasi utama"><p className="nav-caption">Ruang kerja</p>
          <a href="#statistik" className={page === 'statistics' ? 'nav-active' : ''} aria-current={page === 'statistics' ? 'page' : undefined} onClick={() => { setMenuOpen(false); if (page === 'statistics') scrollTo(0) }}><LayoutDashboard />Dashboard</a>
          <a href="#simulasi" className={page === 'simulation' ? 'nav-active' : ''} aria-current={page === 'simulation' ? 'page' : undefined} onClick={() => { setMenuOpen(false); if (page === 'simulation') scrollTo(0) }}><Sprout />Simulasi</a>
          <button onClick={() => { sessionsDialog.current?.showModal(); setMenuOpen(false) }}><History />Riwayat sesi<span className="nav-count">{book.sessions.length}</span></button>
          <button onClick={() => openStatisticsPanel('session-comparison')}><GitCompareArrows />Bandingkan sesi</button>
          <p className="nav-caption">Perangkat & model</p>
          <button onClick={() => openStatisticsPanel('device-panel')}><Radio />Status perangkat</button>
          <button onClick={() => openStatisticsPanel('terminal-page')}><Terminal />Terminal</button>
          <button onClick={() => { guideDialog.current?.showModal(); setMenuOpen(false) }}><BookOpen />Panduan</button>
        </nav>
        <div className="sidebar-garden"><Leaf aria-hidden="true" /><span>Satu pot.<br />Banyak cerita tumbuh.</span><p>Amati perubahan, pahami kebutuhan tanaman.</p><a href="#simulasi" onClick={() => setMenuOpen(false)}>Ke ruang tanam<ArrowUpRight /></a></div>
        <p className="sidebar-footnote"><span className="status-dot" />Simulasi lokal</p>
      </div>
    </aside>
    <div className="app-content">
    <header className="app-topbar">
      <button className="session-switcher" onClick={() => sessionsDialog.current?.showModal()}><span className="session-avatar"><Leaf /></span><span><small>Sesi aktif</small><strong>{session.name}</strong></span><ChevronRight /></button>
      <div className="topbar-tools"><ClockSettings clock={session.clock} hour={data.now_h} onChange={clock => { setRunning(false); setPauseNote('Zona waktu diubah. Tekan Lanjutkan waktu.'); edit({ clock }) }} /><button className="icon-button theme-toggle" aria-label={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</button></div>
    </header>
    <motion.main key={page} initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22, ease: "easeOut" }} id="main" tabIndex={-1} className={page === 'statistics' ? 'page-statistics' : 'page-simulation'}>
      <div className="page-heading"><div><h1>{page === 'statistics' ? 'Dashboard' : 'Ruang tanam'}</h1><p>{page === 'statistics' ? 'Kenali pola, rawat tanaman dengan tepat.' : 'Mulai dari bibit, rawat seiring waktu.'}</p></div><div className="page-actions">
        {page === 'statistics' && <a className="button primary" href="#simulasi"><Sprout />Ruang tanam</a>}
        <details className="session-menu"><summary className="button"><History />Sesi<ChevronRight /></summary><div className="session-menu-body"><strong>{session.name}</strong><button className="button" onClick={() => sessionsDialog.current?.showModal()}><History />Lanjutkan sesi ({book.sessions.length})</button><button className="button" onClick={() => importFile.current?.click()}><ArrowUpFromLine />Impor</button><button className="button" onClick={exportSession}><ArrowDownToLine />Ekspor sesi</button></div></details></div></div>
      <input ref={importFile} type="file" accept=".json,application/json" className="sr-only" aria-label="Impor kasus JSON" onChange={e => void importSession(e.target.files?.[0])} />
      <div className="saved-session-bar"><span className="active-session-name"><Leaf />{data.profile.crop} · {journey ? 'Perjalanan tanam' : 'Eksperimen'}</span><span className={`save-status ${saveState.error ? 'save-failed' : ''}`} role="status"><Save />{saveState.error ? 'Belum tersimpan' : saveState.book === book ? 'Tersimpan di perangkat' : 'Menyimpan…'}</span></div>
      {saveState.error && <div className="storage-error" role="alert"><p>{saveState.error}</p><div><button className="button" onClick={exportSession}>Ekspor sesi aktif</button>{!boot.error && <button className="button" onClick={persist}>Coba simpan lagi</button>}</div></div>}
      {page === 'simulation' && <div className="studio-setup">
      <section className="mode-bar" aria-label="Mode simulator"><div className="mode-options"><button aria-pressed={journey} onClick={() => changeMode('journey')}><Sprout /><span>Perjalanan tanam</span></button><button aria-pressed={!journey} onClick={() => changeMode('experiment')}><FlaskConical /><span>Eksperimen</span></button></div></section>
      <details className="setup-disclosure"><summary><Settings2 />Atur tanaman & skenario<ChevronRight /></summary><div className="session-bar"><button className="button" onClick={() => openNew(journey ? createJourney(loadScenario(onion ? 7 : 0).data) : loadScenario(onion ? 7 : 0))}>{journey ? 'Pot baru' : 'Eksperimen baru'}</button><label><Leaf /><select aria-label="Profil tanaman" value={onion ? 'bawang' : 'cabai'} onChange={e => { const i = e.target.value === 'bawang' ? 7 : 0; if (journey) openNew(createJourney(loadScenario(i).data)); else reset(i) }}><option value="cabai">Cabai</option><option value="bawang">Bawang merah</option></select></label><span className="session-media">{data.profile.media}<span className="mini-dot" />Pot 3–5 L</span><button className="text-button" onClick={() => { setProfileVersion(v => v + 1); profileDialog.current?.showModal() }}><Settings2 />Acuan lokal<ArrowUpRight /></button>{!journey && <label className="scenario-select"><span>Skenario</span><select aria-label="Skenario simulasi" value={scenario} onChange={e => reset(Number(e.target.value))}>{scenario === 'custom' && <option value="custom">Eksplorasi manual</option>}{scenarios.map((s, i) => <option key={s.name} value={i}>{String(i + 1).padStart(2, '0')} · {s.name}</option>)}</select></label>}</div></details>
      </div>}
      {error && <div className="error-banner" role="alert"><TriangleAlert />{error}<button className="icon-button" onClick={() => setError('')} aria-label="Tutup kesalahan"><X /></button></div>}
      {page === 'simulation' && <>

      <div className="workspace workspace-v2 studio-workspace"><div className="main-workspace"><div className="simulation-grid"><SimulationOverview data={data} decision={result} />
        <div className="visual-stack"><PlantPotVisualizer clock={session.clock} key={session.id} running={running} rate={sim.rate} day={day} developmentDay={developmentDay} elapsed={data.now_h} planted={!journey || sim.planted} journey={journey} onion={onion} moisture={last.moisture} contact={result.decision !== 'PERIKSA_SENSOR'} />
{!journey && <section className="timeline" aria-label="Ilustrasi fase tanaman"><div className="timeline-label"><span>Ilustrasi fase tanaman</span><strong>Hari <b>{String(day).padStart(2, '0')}</b><small> / {maxDay} HST</small></strong></div>
        <div className="timeline-controls"><button className={`icon-button play-button ${playing ? 'playing' : ''}`} aria-label={playing ? 'Jeda timelapse' : 'Putar timelapse'} onClick={() => { if (day >= maxDay) setDay(0); setPlaying(!playing) }}>{playing ? <Pause /> : <Play />}</button><button className="icon-button" aria-label="Reset timelapse" onClick={() => { setDay(0); setPlaying(false) }}><RotateCcw /></button></div>
        <div className="timeline-track"><input aria-label="Hari setelah tanam" type="range" min="0" max={maxDay} step="1" value={day} onChange={e => { setDay(Number(e.target.value)); setPlaying(false) }} /><div className="timeline-phases"><span>Awal tanam</span><span>Vegetatif</span><span>{onion ? 'Pembentukan umbi' : 'Berbunga'}</span><span>{onion ? 'Pematangan' : 'Berbuah'}</span></div></div>
        <label className="speed-label"><span className="sr-only">Kecepatan timelapse</span><select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select></label><span className="tag illustration-tag">ILUSTRASI</span><p className="timeline-explanation">HST mengubah gambar saja. Waktu sensor maju saat menambah sampel.</p>
      </section>}
      {journey && <div className="journey-progress"><span>{sim.planted ? `HST ${day} / ${maxDay}` : 'Bibit siap ditanam'}</span><progress aria-label="Perjalanan tanam" max={maxDay} value={day} /><span>{phaseAt(developmentDay, onion)}</span></div>}
        </div>
        <div className="control-stack"><SimulationControls pauseNote={playbackNote} recommendation={recommendation} session={session} running={running} onChange={configureSimulation} onRun={toggleRunning} onAdvance={advance} onPlant={() => { edit(plantSeed(session)); setPauseNote(''); setRunning(true) }} onWater={() => { edit(waterSimulation(session, 150)); setNotice('Siraman dicatat. Respons muncul pada sampel berikutnya.') }} onFeed={() => edit(recordFertilizer(session))} />
        {!journey && sim.source === 'manual' &&
        <SensorControls clock={session.clock} key={session.id} reading={reading} setReading={value => edit({ reading: value })} now={data.now_h} freshPh={session.freshPh} setFreshPh={value => edit({ freshPh: value })} volume={session.volume} setVolume={value => edit({ volume: value })} canAdd={data.samples.length < 10000} onSample={freshPh => {
          try { commit(addSample(data, { ...reading, ph: freshPh ? reading.ph : null, valid: true }), `Sampel baru: indeks ${reading.moisture}, ${reading.temp_c} °C; pH ${freshPh ? reading.ph : 'tidak diukur'}.`, 'data') }
          catch (err) { setError(err instanceof Error ? err.message : 'Sampel gagal') }
        }} onWater={volume => { commit(recordWatering(data, volume), `Penyiraman ${volume} mL dicatat. Menunggu sampel respons menit ke-10–45.`); setNotice(`Siraman ${volume} mL dicatat; pembacaan sensor tidak diubah.`) }} onFault={fault} />
        }</div>
      </div></div><a href="#statistik" className="button statistics-link"><Activity />Lihat statistik sesi<ArrowUpRight /></a></div>
      </>}
      {page === 'statistics' && <div className="statistics-page">
        <StatisticsDashboard clock={session.clock} key={session.id} data={data} decision={result}
          care={<div className="panel dashboard-care">{recommendation}<a className="button primary" href="#simulasi">{journey && !sim.planted ? 'Mulai menanam' : 'Buka perawatan'}<ArrowUpRight /></a></div>}
          readings={<section className="panel dashboard-readings" aria-labelledby="readings-title"><header><h3 id="readings-title">Kondisi pot saat ini</h3><span className="crop-tag"><Sprout />{data.profile.crop}</span></header><dl>
            <div><dt><Droplets />Kelembapan</dt><dd>{last.valid ? last.moisture : 'Gagal'}<small>{last.valid ? '/ 100' : ''}</small></dd></div>
            <div><dt><Thermometer />Suhu tanah</dt><dd>{last.valid ? last.temp_c.toFixed(1) : 'Gagal'}<small>{last.valid ? '°C' : ''}</small></dd></div>
            <div><dt><FlaskConical />pH terakhir</dt><dd>{phRow?.ph?.toFixed(1) ?? '—'}<small>{!phRow ? 'belum diukur' : !data.profile.ph_validated ? 'belum tervalidasi' : phFresh ? 'tervalidasi' : 'lebih dari 24 jam'}</small></dd></div>
          </dl><p className="readings-status"><span className={`status-dot ${!dataGood ? 'alert' : ''}`} />{dataGood ? 'Pembacaan valid' : 'Periksa pembacaan'} · {ageMinutes} menit lalu</p><div className="plant-stage"><span>{journey ? 'Perjalanan tanam' : 'Ilustrasi fase tanaman'}<strong>{journey && !sim.planted ? 'Belum ditanam' : `${day} HST`}</strong></span><progress aria-label={journey ? 'Umur perjalanan tanam' : 'Umur ilustrasi'} value={day} max={maxDay} /><p>{phaseAt(developmentDay, onion)}{journey ? ' · fase model' : ' · ilustrasi'}</p></div></section>}
          playback={<section className="panel dashboard-clock" aria-labelledby="dashboard-clock-title"><div className="clock-card-heading"><Clock3 /><h3 id="dashboard-clock-title">Waktu sesi</h3></div><p>{clockDate(session.clock, data.now_h)} · {utcLabel(session.clock, data.now_h)}</p><strong>{clockTime(session.clock, data.now_h)}</strong><span className="clock-play-state">{journey && !sim.planted ? 'Menunggu bibit ditanam' : running ? 'Timelapse berjalan' : 'Waktu dijeda'}</span><button className="button" disabled={simulationStopped(session)} onClick={toggleRunning}>{running ? <Pause /> : <Play />}{running ? 'Jeda waktu' : 'Lanjutkan waktu'}</button><small className="clock-pause-note" role="status">{playbackNote || 'Sinkron dengan grafik & terminal'}</small></section>}
        />
        <DevicePanel key={`device-${session.id}`} clock={session.clock} snapshot={session.deviceSnapshot} onImport={importDevice} />
        <SessionComparison sessions={book.sessions} activeId={book.activeId} onSnapshot={snapshot} />
        <details className="technical-body terminal-page panel"><summary className="technical-summary">Detail teknis & terminal<ChevronRight /></summary><div className="technical-content"><div className="terminal-page-heading"><h2>Terminal sesi</h2><span className="tag">{running ? 'WAKTU BERJALAN' : 'DIJEDA'}</span><button className="button" onClick={toggleRunning} disabled={simulationStopped(session)}>{running ? 'Jeda' : 'Lanjutkan waktu'}</button></div><div className="decision-code"><Activity /><code>{result.decision}</code></div>
        <TerminalSimulator clock={session.clock} data={data} decision={result} logs={logs} />
        <details className="evidence-detail"><summary>Bukti pendukung<ChevronRight /></summary><p>{result.evidence.watering_response}</p><p>{result.evidence.ph_status}</p><p>Fase ilustrasi: {phase}. Fase profil: {data.profile.phase}. HST tidak mengubah acuan lokal.</p></details></div></details>
      </div>}
      <footer className="page-footer"><span><span className="status-dot" />Simulasi lokal · data sintetis · tanpa perangkat terhubung</span><span>Makalah satu pot / September 2026</span></footer>
    </motion.main>
    </div></div>
    <div className={`toast ${notice ? 'visible' : ''}`} role="status">{notice && <><Check />{notice}</>}</div>
    <dialog ref={profileDialog} aria-labelledby="profile-title" className="modal"><ProfileEditor key={profileVersion} profile={data.profile} onApply={applyProfile} onClose={() => profileDialog.current?.close()} /></dialog>
    <dialog ref={sessionsDialog} aria-labelledby="sessions-title" className="modal sessions-modal"><SessionLibrary sessions={book.sessions} activeId={book.activeId} running={running} onResume={resume} onClose={() => sessionsDialog.current?.close()} onRename={(id, name) => setBook(old => ({ ...old, sessions: old.sessions.map(s => s.id === id ? { ...s, name, updatedAt: Date.now() } : s) }))} /></dialog>
    <dialog ref={guideDialog} aria-labelledby="guide-title" className="modal guide-modal"><div className="dialog-heading"><div><h2 id="guide-title">Tentang simulator</h2><p>Asisten perawatan tanaman dalam pot berbasis riwayat sensor.</p></div><button className="icon-button" aria-label="Tutup panduan" onClick={() => guideDialog.current?.close()}><X /></button></div>
      <h3>Alur eksplorasi</h3><ol><li>Pilih salah satu dari 10 skenario makalah.</li><li>Pilih Perjalanan tanam atau Eksperimen. Dashboard memuat grafik, perbandingan, JSON, dan Jejak aturan.</li><li>Atur masukan, lalu tambah sampel setiap 30 menit simulasi.</li><li>Catat siraman; masukkan pembacaan baru untuk mengevaluasi respons.</li><li>Ekspor sesi untuk menyimpan input, keputusan, dan log.</li></ol>
      <h3>Tiga parameter, acuan lokal</h3><p>Kelembapan adalah indeks 0–100 hasil acuan media, bukan kadar air volumetrik. Suhu memakai DS18B20. pH berasal dari sesi ukur baru; sampel tanpa pengukuran pH disimpan sebagai null.</p>
      <h3>Mode perjalanan dan sampel</h3><p>Perjalanan dimulai dengan Tanam & mulai. Sesi baru berjalan terus sampai dijeda. Jeda saat perhatian bersifat opsional; saat dilanjutkan, peringatan yang sama tidak langsung menjeda lagi. Waktu sensor, grafik, dan terminal memakai satu timestamp UTC. Zona awal mengikuti perangkat dan bisa diganti manual; HST tetap durasi sejak tanam. Waktu sensor dan HST bergerak bersama; siklus pagi–malam memengaruhi suhu dan pengeringan sintetis. Model perkembangan melambat ketika kondisi media kurang mendukung. Semua dinamika ini untuk latihan, belum divalidasi sebagai model pertumbuhan tanaman. Mode acak menambah variasi, sedangkan manual tersedia di Eksperimen.</p><p>Pupuk memakai jadwal pribadi (0 = nonaktif) dan catatan tindakan. Sensor tidak menentukan kebutuhan/dosis pupuk; catatan tidak mengubah pH, nutrisi, atau pertumbuhan.</p><h3>Batas model</h3><p>Timelapse 0–90 HST untuk cabai dan 0–65 HST untuk bawang hanya menggambarkan fase. Tidak mengubah ambang, memprediksi hasil panen, mengukur EC/NPK, mendiagnosis penyakit, atau menentukan dosis pupuk dan dolomit.</p><p>Proyeksi kering memakai regresi linear lokal, minimal 6 sampel selama 2,5 jam, R² ≥0,8, dan horizon maksimal 12 jam. Bukan waktu siram pasti.</p><p>Sesi disimpan otomatis di browser ini. Refresh memulihkan sesi aktif dalam keadaan dijeda. Ganti skenario membuat sesi baru; gunakan Lanjutkan sesi untuk membuka eksplorasi sebelumnya. Ekspor versi baru memulihkan draf, log, serta posisi ilustrasi saat diimpor. Kasus Python tetap didukung. Simpanan tidak tersinkron antarperangkat atau alamat hosting; gunakan ekspor JSON untuk memindahkannya.</p>
      <p className="source-note">Sumber: Makalah_Asisten_Perawatan_Tanaman_Satu_Pot.docx, Bab V, dan simulasi_pot.py. Semua skenario sintetis; belum divalidasi pada tanaman atau perangkat aktual.</p>
    </dialog>
  </>
}
