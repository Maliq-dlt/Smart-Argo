import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'

import { ArrowCounterClockwise, ArrowUpRight, BookOpenText, Broadcast, CaretRight, ChartLine, Check, Clock, DownloadSimple, Drop, Flask, FolderSimple, GitDiff, Hourglass, Leaf, LinkSimple, Pause, Play, Plant, Printer, Pulse, Question, ShieldCheck, SlidersHorizontal, SquaresFour, TerminalWindow, TrendDown, TrendUp, UploadSimple, Warning, X, UserCircle } from '@phosphor-icons/react'
import { addSample, evaluate, parseCase, phaseAt, type PotCase, type Profile } from './lib/agronomyEngine'
import scenarios from './lib/scenarios.json'
import ThemeToggle from './components/ThemeToggle'
import SegmentedControl from './components/ui/segmented-control'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog'
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from './components/ui/popover'
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription, SheetClose } from './components/ui/sheet'
import { SelectField } from './components/ui/select'
import PlantPotVisualizer, { type CareEffect } from './components/PlantPotVisualizer'
import PlantMood from './components/PlantMood'
import AgroMark from './components/AgroMark'
import SessionReport from './components/SessionReport'
import SensorControls from './components/SensorControls'
import StatisticsDashboard from './components/StatisticsDashboard'
import TerminalSimulator from './components/TerminalSimulator'
import SessionComparison from './components/SessionPanel'
import PlantStage from './components/dashboard/PlantStage'
import TrendCard from './components/dashboard/TrendCard'
import CareCard from './components/dashboard/CareCard'
import SessionClockCard from './components/dashboard/SessionClockCard'
import { appendSession, createSession, exportSession as encodeSession, importSession as decodeSession, readBook, saveBook, sessionTime, STORAGE_KEY, type Session, type SessionBook, type LogEntry } from './lib/sessionStore'
import ProfileEditor from './components/ProfileEditor'
import ClockSettings from './components/ClockSettings'
import DevicePanel from './components/DevicePanel'
import ChainProofDialog from './components/ChainProofDialog'
import { settledMood } from './lib/mascot'
import MiroEcosystemWorkspace from './components/MiroEcosystemWorkspace'
import AccountProvider from './components/AccountProvider'
import { useAccount } from './components/accountContext'
import AccountGate from './components/AccountGate'
import AccountMenu from './components/AccountMenu'
import ProfilePage from './components/ProfilePage'
import { entryView } from './lib/siteRoute'
import { productAccountConfigured, signInRequired } from './lib/productAccountClient'
import { clockDate, clockTime, utcLabel } from './lib/sessionClock'
import { deviceStatuses, type DeviceSnapshot } from './lib/telemetry'
import SimulationControls from './components/SimulationControls'
import SimulationOverview from './components/SimulationOverview'
import { createJourney, simulationOf, advanceSimulation, plantSeed, waterSimulation, canUndoWater, undoWaterSimulation, recordFertilizer, feedingDue, shouldPause, simulationStopped, simulationStopReason, sampleIntervalMs, logEvent, type SimulationState } from './lib/simulation'

gsap.registerPlugin(ScrollToPlugin)

// Each page names itself once in the top bar; pages without a plant scene open with one plain sentence instead.
const pages = [
  { id: 'statistics', hash: '#statistik', label: 'Dashboard', title: 'Dashboard', lead: '', icon: SquaresFour },
  { id: 'simulation', hash: '#simulasi', label: 'Simulasi', title: 'Ruang tanam', lead: '', icon: Plant },
  { id: 'comparison', hash: '#bandingkan', label: 'Bandingkan sesi', title: 'Bandingkan sesi', lead: 'Dua riwayat, satu sudut pandang.', icon: GitDiff },
  { id: 'devices', hash: '#perangkat', label: 'Status perangkat', title: 'Status perangkat', lead: 'Periksa paket sensor dari berkas.', icon: Broadcast },
  { id: 'ecosystem', hash: '#ekosistem', label: 'Ekosistem', title: 'Ekosistem Produk', lead: 'Akun, aktivasi, energi, reward, dan kurasi profil.', icon: ShieldCheck },
  { id: 'terminal', hash: '#terminal', label: 'Terminal', title: 'Terminal', lead: 'Kejadian, data, dan alasan setiap keputusan.', icon: TerminalWindow },
  // Opened from the account menu, not the rail.
  { id: 'profile', hash: '#profil', label: 'Profil', title: 'Profil', lead: 'Akun, keamanan, dan produk Anda.', icon: UserCircle, hidden: true },
] as const
const GUEST_KEY = 'smart-agro.guest'
const pageFromHash = () => pages.find(p => p.hash === location.hash)?.id ?? 'simulation'
const one = (value: number) => value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

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

function Simulator() {
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
  const [page, setPage] = useState(pageFromHash)
  const [hash, setHash] = useState(() => location.hash)
  const account = useAccount()
  const [guest, setGuest] = useState(() => { try { return localStorage.getItem(GUEST_KEY) === '1' } catch { return false } })
  // Signed in while the address still says #masuk (back from the gate): open the dashboard instead.
  useEffect(() => { if (account.signedIn && hash === '#masuk') location.replace('#statistik') }, [account.signedIn, hash])
  const currentPage = pages.find(p => p.id === page)!
  const [careEffect, setCareEffect] = useState<CareEffect | null>(null)
  const careId = useRef(0)
  const showCareEffect = (kind: CareEffect['kind']) => setCareEffect({ kind, id: ++careId.current })
  useEffect(() => {
    if (!careEffect) return
    const timer = setTimeout(() => setCareEffect(null), 1800)
    return () => clearTimeout(timer)
  }, [careEffect])
  const reducedMotion = useReducedMotion()
  const previousPage = useRef<typeof page | null>(null), pendingCare = useRef(false)
  const scrollTween = useRef<gsap.core.Tween | null>(null)
  const scrollTo = useCallback((top: number) => {
    scrollTween.current?.kill()
    if (reducedMotion) window.scrollTo({ top, behavior: 'instant' })
    else scrollTween.current = gsap.to(window, { scrollTo: { y: top, autoKill: true }, duration: .65, ease: 'power2.inOut' })
  }, [reducedMotion])
  useEffect(() => () => { scrollTween.current?.kill() }, [])
  const sim = simulationOf(session), journey = sim.mode === 'journey'
  const developmentDay = journey ? Math.floor(sim.growthHours / 24) : session.day
  const [printSession, setPrintSession] = useState<Session | null>(null)
  useEffect(() => {
    const prepare = () => flushSync(() => {
      setPrintSession(currentSession.current); setRunning(false); setPlaying(false)
      setPauseNote('Waktu dijeda untuk ringkasan cetak. Tekan Lanjutkan waktu setelah selesai.')
    })
    const finish = () => setPrintSession(null)
    window.addEventListener('beforeprint', prepare); window.addEventListener('afterprint', finish)
    return () => { window.removeEventListener('beforeprint', prepare); window.removeEventListener('afterprint', finish) }
  }, [])
  const [notice, setNotice] = useState(boot.restored ? 'Sesi terakhir dipulihkan. Ilustrasi dijeda; jam sensor tetap tersimpan.' : '')
  const [error, setError] = useState(''), [profileVersion, setProfileVersion] = useState(0)
  const [modal, setModal] = useState<'profile' | 'guide' | 'proof' | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const pendingProfile = useRef(false), modalTrigger = useRef<HTMLElement | null>(null)
  const importFile = useRef<HTMLInputElement>(null)
  function openModal(name: NonNullable<typeof modal>, trigger = document.activeElement) {
    modalTrigger.current = trigger instanceof HTMLElement ? trigger : null
    setModal(name)
  }
  function restoreModalFocus(event: Event) {
    event.preventDefault()
    const target = modalTrigger.current?.isConnected && modalTrigger.current.getClientRects().length ? modalTrigger.current : document.getElementById('main')
    target?.focus({ preventScroll: true })
  }
  const result = evaluate(data), last = data.samples.at(-1)!
  const onion = data.profile.crop.toLowerCase().includes('bawang'), maxDay = onion ? 65 : 90
  const phase = phaseAt(day, onion), phRow = [...data.samples].reverse().find(r => r.valid && r.ph !== null)
  const phFresh = phRow && data.now_h - phRow.t_h <= 24 && data.profile.ph_validated
  const ageMinutes = Math.round((data.now_h - last.t_h) * 60)
  const dataGood = last.valid && data.now_h - last.t_h <= 5 / 60 && result.decision !== 'PERIKSA_SENSOR'
  const blocked = ['KALIBRASI_LOKAL', 'PULIHKAN_DATA', 'PERIKSA_SENSOR'].includes(result.decision)
  const calm = result.decision === 'AMATI'
  // The mascot eases only after two evaluations agree; the previous one is the case as it stood one sample earlier.
  const previous = data.samples.length > 1 ? evaluate({ ...data, samples: data.samples.slice(0, -1), now_h: data.samples.at(-2)!.t_h, watering: data.watering && data.watering.t_h <= data.samples.at(-2)!.t_h ? data.watering : null }) : null
  const mood = settledMood(result.decision, previous?.decision ?? null)
  const playbackNote = running ? '' : simulationStopReason(session) || pauseNote
  function toggleRunning() { setPauseNote(running ? 'Dijeda oleh pengguna.' : ''); setRunning(!running) }

  useEffect(() => {
    // A page change cross-fades the whole view (see "Page change" in styles.css). The swap runs inside the transition, so
    // the new page, its scroll position and its focus are all in place before the new view is captured. Reduced motion,
    // browsers without View Transitions, a running theme reveal and routes that leave the app swap at once.
    const root = document.documentElement
    let current: ViewTransition | null = null
    const swap = () => { setPage(pageFromHash()); setHash(location.hash); setCareEffect(null) }
    const navigate = () => {
      const animate = typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches
        && root.dataset.themeTransition === undefined && pages.some(p => p.hash === location.hash)
      if (!animate) return swap()
      root.dataset.pageTransition = 'true'
      const transition = document.startViewTransition(() => flushSync(swap))
      current = transition
      // A quick second change skips this one; only the latest transition clears the flag.
      transition.finished.finally(() => { if (current === transition) { delete root.dataset.pageTransition; current = null } })
    }
    window.addEventListener('hashchange', navigate)
    return () => { window.removeEventListener('hashchange', navigate); delete root.dataset.pageTransition }
  }, [])
  // Layout effect: inside a page transition the new view is captured right after the swap, so focus and scroll must
  // already be final. The jump to the top is instant; a scroll animation here would play under the cross-fade.
  useLayoutEffect(() => {
    if (previousPage.current === page) return
    previousPage.current = page
    const care = pendingCare.current
    const target = care && page === 'simulation' ? document.querySelector<HTMLElement>('.controls-panel') ?? document.querySelector<HTMLElement>('.simulation-controls') : document.getElementById('main')
    pendingCare.current = false
    scrollTween.current?.kill()
    target?.focus({ preventScroll: true })
    window.scrollTo({ top: care && target ? Math.max(0, target.getBoundingClientRect().top + window.scrollY - 24) : 0, behavior: 'instant' })
  }, [page])
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
      simulation: s.simulation && checked.now_h !== s.data.now_h ? { ...s.simulation, waterUndo: undefined } : s.simulation,
      logs: [...s.logs, { id: (s.logs.at(-1)?.id ?? 0) + 1, time: sessionTime(next.now_h), kind, message },
        { id: (s.logs.at(-1)?.id ?? 0) + 2, time: sessionTime(next.now_h), kind: 'rule' as const, message: output.decision }].slice(-500) }))
    setError('')
  }
  function openNew(next: Session) {
    setBook(old => appendSession(old, next)); setCareEffect(null); setPlaying(false); setRunning(false); setPauseNote(''); setError('')
  }
  function reset(index: number) {
    openNew(loadScenario(index))
    setNotice('Sesi baru dibuka. Riwayat sebelumnya tetap tersimpan untuk perbandingan.')
  }
  function resume(id: string) {
    const selected = book.sessions.find(s => s.id === id)
    if (!selected) return
    const stopped = simulationStopReason(selected)
    setBook(old => ({ ...old, activeId: id })); setCareEffect(null); setPlaying(false); setRunning(!stopped); setPauseNote(stopped); setError(''); setModal(null)
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
    edit(s => ({ ...s, simulation: { ...simulationOf(s), ...change, ...(change.source ? { waterUndo: undefined } : {}) } }))
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
    setModal(null); setNotice(mediaChanged ? 'Sesi media baru dibuka. Riwayat sebelumnya tetap tersedia.' : 'Acuan lokal diterapkan.')
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
  function recordWater(volume: number) {
    edit(s => waterSimulation(s, volume))
    setRunning(false); showCareEffect('water')
    setPauseNote('Siraman menunggu sampel berikutnya. Tinjau catatan, lalu lanjutkan waktu.')
    setNotice('Siraman dicatat. Pembacaan sensor tetap sampai sampel berikutnya.')
  }
  const undoAvailable = canUndoWater(session)
  // Toast Undo pattern: https://21st.dev/@shugar/components/toast
  const waterStatus = undoAvailable && <div className="pending-water">
    <div role="status"><Drop weight="duotone" aria-hidden="true" /><span><strong>Siraman {data.watering!.volume_ml.toLocaleString('id-ID')} mL tercatat</strong><small>{sim.source === 'manual' ? 'Tambahkan sampel untuk mengamati respons.' : running ? 'Menunggu sampel berikutnya.' : 'Lanjutkan waktu untuk memproses sampel berikutnya.'}</small></span></div>
    <button type="button" className="button" onClick={() => {
      edit(undoWaterSimulation); setCareEffect(null); setNotice('Siraman dibatalkan. Riwayat sensor tetap utuh.')
      setPauseNote('Siraman dibatalkan. Waktu tetap dijeda.')
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(page === 'statistics' ? '.dashboard-care > a' : '.care-actions button, .watering-control button')
        target?.focus({ preventScroll: true })
      })
    }}><ArrowCounterClockwise aria-hidden="true" />Batalkan siraman</button>
  </div>
  const recommendation = <section className={`care-recommendation ${calm ? 'calm' : blocked ? 'blocked' : ''}`} aria-labelledby="decision-heading">
    <div className="decision-eyebrow">{calm ? <ShieldCheck weight="duotone" aria-hidden="true" /> : <Warning weight="duotone" aria-hidden="true" />}<h2 id="decision-heading">{blocked ? 'Periksa sebelum merawat' : 'Catatan perawatan'}</h2></div>
    <h3>{journey && !sim.planted ? 'Bibit siap memulai perjalanan' : result.action}</h3><p>{journey && !sim.planted ? 'Tanam untuk memulai waktu, lalu amati perubahan media dan perkembangan tanaman.' : result.reason}</p>
    {result.evidence.eta_h !== null && <span className="care-eta"><Clock aria-hidden="true" />Menuju acuan air: {result.evidence.eta_h} jam</span>}
  </section>

  // Dashboard facts, all straight from the engine and the session; nothing here is estimated for display.
  const awaitingPlant = journey && !sim.planted
  const { slope_per_h, eta_h, low } = result.evidence
  const validShare = data.samples.length ? Math.round(data.samples.filter(s => s.valid).length / data.samples.length * 100) : 0
  const openCare = (event: MouseEvent<HTMLAnchorElement>) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) pendingCare.current = true }
  const phaseText = awaitingPlant ? 'Belum ditanam' : `${phaseAt(developmentDay, onion)} · HST ${day}`
  const lead = currentPage.lead
  const openGuide = () => openModal('guide')
  const view = entryView({ configured: productAccountConfigured, ready: account.ready, signedIn: account.signedIn, guest: guest && !signInRequired, hash })
  if (view === 'loading') return <main className="site-initial-loading" role="status"><p>Memeriksa sesi akun…</p></main>
  if (view === 'gate') return <AccountGate onGuest={signInRequired ? undefined : () => {
    try { localStorage.setItem(GUEST_KEY, '1') } catch { /* storage blocked: guest for this visit only */ }
    setGuest(true)
    if (!location.hash || location.hash === '#masuk') location.hash = '#statistik'
  }} />
  return <>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Lewati ke konten</a>
    <div className="app-shell">
    <aside className="app-rail" aria-label="Navigasi aplikasi">
      <a className="rail-brand" href="#" aria-label="Smart Agro · Beranda"><AgroMark /></a>
      {/* Rail with a sliding active marker, after "Rail Panel Sidebar" by dhxwhy: https://21st.dev/@dhxwhy/components/rail-panel-sidebar */}
      <nav className="rail-nav" aria-label="Navigasi utama">
        {pages.filter(p => !('hidden' in p)).map(({ id, hash, label, icon: Icon }) => <a key={id} href={hash} className="rail-link" data-label={label} aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => { if (page === id) scrollTo(0) }}>
          {page === id && <motion.span className="rail-active" layoutId="rail-active" transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} aria-hidden="true" />}
          <Icon weight={page === id ? 'fill' : 'regular'} aria-hidden="true" />
        </a>)}
      </nav>
      <button type="button" className="rail-link rail-guide" data-label="Panduan" aria-label="Panduan" onClick={openGuide}><Question aria-hidden="true" /></button>
    </aside>
    <div className="app-content">
    <header className="app-topbar">
      <a className="topbar-brand" href="#" aria-label="Smart Agro · Beranda"><AgroMark /></a>
      <h1 className="page-title"><i aria-hidden="true" />{currentPage.title}</h1>
      <div className="session-pill"><PlantMood mood={!sim.planted ? 'ready' : mood} /><span><strong>{session.name}</strong><small>{data.profile.crop} · {journey ? 'Perjalanan tanam' : 'Eksperimen'}</small></span>
        <span className={`save-status ${saveState.error ? 'save-failed' : ''}`} role="status"><i aria-hidden="true" />{saveState.error ? 'Belum tersimpan' : saveState.book === book ? 'Tersimpan' : 'Menyimpan…'}</span></div>
      <div className="topbar-tools">
        <ClockSettings clock={session.clock} hour={data.now_h} onChange={clock => { setRunning(false); setPauseNote('Zona waktu diubah. Tekan Lanjutkan waktu.'); edit({ clock }) }} />
        <Popover><PopoverTrigger asChild><button type="button" className="icon-button" aria-label="Berkas" title="Berkas"><FolderSimple aria-hidden="true" /></button></PopoverTrigger>
          <PopoverContent className="session-actions-popover" align="end" aria-label="Menu sesi"><strong>{session.name}</strong>
            <PopoverClose asChild><button className="menu-item" onClick={() => importFile.current?.click()}><UploadSimple aria-hidden="true" />Impor</button></PopoverClose>
            <PopoverClose asChild><button className="menu-item" onClick={exportSession}><DownloadSimple aria-hidden="true" />Ekspor sesi</button></PopoverClose>
            <PopoverClose asChild><button className="menu-item" onClick={() => setModal('proof')}><LinkSimple aria-hidden="true" />Bukti blockchain</button></PopoverClose>
            <PopoverClose asChild><button className="menu-item" onClick={() => window.print()}><Printer aria-hidden="true" />Ringkasan cetak</button></PopoverClose>
          </PopoverContent></Popover>
        <button type="button" className="icon-button topbar-guide" aria-label="Panduan" title="Panduan" onClick={openGuide}><Question aria-hidden="true" /></button>
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
    <main key={page} id="main" tabIndex={-1} className={`app-main page-${page}`}>
      {lead && <p className="page-lead">{lead}</p>}
      <input ref={importFile} type="file" accept=".json,application/json" className="sr-only" aria-label="Impor kasus JSON" onChange={e => void importSession(e.target.files?.[0])} />
      {saveState.error && <div className="storage-error" role="alert"><p>{saveState.error}</p><div><button className="button" onClick={exportSession}>Ekspor sesi aktif</button>{!boot.error && <button className="button" onClick={persist}>Coba simpan lagi</button>}</div></div>}
      {error && <div className="error-banner" role="alert"><Warning weight="duotone" aria-hidden="true" /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Tutup kesalahan"><X aria-hidden="true" /></button></div>}

      {page === 'simulation' && <div className="studio">
        <div className="studio-bar">
          <div className="mode-bar"><SegmentedControl label="Mode simulator" value={sim.mode} onValueChange={value => changeMode(value as SimulationState['mode'])} options={[{ value: 'journey', label: <><Plant aria-hidden="true" />Perjalanan tanam</> }, { value: 'experiment', label: <><Flask aria-hidden="true" />Eksperimen</> }]} /></div>
          <Sheet open={setupOpen} onOpenChange={setSetupOpen}><SheetTrigger asChild><button id="plant-settings" className="button setup-trigger"><SlidersHorizontal aria-hidden="true" />Atur tanaman & skenario</button></SheetTrigger><SheetContent onCloseAutoFocus={event => {
            if (pendingProfile.current) { event.preventDefault(); pendingProfile.current = false; openModal('profile', document.getElementById('plant-settings')) }
          }}><header className="sheet-heading"><SheetTitle>Tanaman & skenario</SheetTitle><SheetDescription>Sesuaikan ruang tanam dengan eksplorasimu.</SheetDescription></header>
            <section className="settings-section"><label className="settings-field"><span>Tanaman</span><SelectField label="Profil tanaman" value={onion ? 'bawang' : 'cabai'} onValueChange={value => { const i = value === 'bawang' ? 7 : 0; if (journey) openNew(createJourney(loadScenario(i).data)); else reset(i) }} options={[{ value: 'cabai', label: 'Cabai' }, { value: 'bawang', label: 'Bawang merah' }]} /></label>
            <p className="section-hint">{data.profile.media} · Pot 3–5 L</p>
            {!journey && <label className="settings-field"><span>Skenario</span><SelectField label="Skenario simulasi" value={scenario} onValueChange={value => { if (value !== 'custom') reset(Number(value)) }} options={[...(scenario === 'custom' ? [{ value: 'custom', label: 'Eksplorasi manual' }] : []), ...scenarios.map((s, i) => ({ value: String(i), label: `${String(i + 1).padStart(2, '0')} · ${s.name}` }))]} /></label>}
            <button className="settings-row" onClick={() => { setProfileVersion(v => v + 1); pendingProfile.current = true; setSetupOpen(false) }}><SlidersHorizontal aria-hidden="true" /><span>Acuan lokal</span><ArrowUpRight aria-hidden="true" /></button></section>
            <section className="settings-section"><h3>Mulai lagi</h3><p className="section-hint">Sesi sebelumnya tetap tersimpan untuk perbandingan.</p><SheetClose asChild><button className="button" onClick={() => openNew(journey ? createJourney(loadScenario(onion ? 7 : 0).data) : loadScenario(onion ? 7 : 0))}><Plant aria-hidden="true" />{journey ? 'Pot baru' : 'Eksperimen baru'}</button></SheetClose></section>
            <SheetClose asChild><button className="button primary sheet-done">Selesai</button></SheetClose>
          </SheetContent></Sheet>
        </div>
        <div className="studio-grid">
          <div className="visual-stack"><SimulationOverview data={data} decision={result} />
            <PlantPotVisualizer careEffect={careEffect} clock={session.clock} key={session.id} running={running} rate={sim.rate} day={day} developmentDay={developmentDay} elapsed={data.now_h} planted={!journey || sim.planted} journey={journey} onion={onion} moisture={last.moisture} contact={result.decision !== 'PERIKSA_SENSOR'} />
            {!journey && <section className="panel timeline" aria-label="Ilustrasi fase tanaman"><div className="timeline-label"><span>Ilustrasi fase</span><strong>Hari <b>{String(day).padStart(2, '0')}</b><small> / {maxDay} HST</small></strong></div>
              <div className="timeline-controls"><button className={`icon-button play-button ${playing ? 'playing' : ''}`} aria-label={playing ? 'Jeda timelapse' : 'Putar timelapse'} onClick={() => { if (day >= maxDay) setDay(0); setPlaying(!playing) }}>{playing ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}</button><button className="icon-button" aria-label="Reset timelapse" onClick={() => { setDay(0); setPlaying(false) }}><ArrowCounterClockwise aria-hidden="true" /></button></div>
              <div className="timeline-track"><input aria-label="Hari setelah tanam" type="range" min="0" max={maxDay} step="1" value={day} style={{ '--fill': `${day / maxDay * 100}%` } as CSSProperties} onChange={e => { setDay(Number(e.target.value)); setPlaying(false) }} /><div className="timeline-phases"><span>Awal tanam</span><span>Vegetatif</span><span>{onion ? 'Pembentukan umbi' : 'Berbunga'}</span><span>{onion ? 'Pematangan' : 'Berbuah'}</span></div></div>
              <label className="speed-label"><span className="sr-only">Kecepatan timelapse</span><SelectField label="Kecepatan timelapse" value={speed} onValueChange={value => setSpeed(Number(value))} options={[1, 2, 5, 10].map(value => ({ value, label: `${value}×` }))} /></label>
              <p className="timeline-explanation">Hari setelah tanam (HST) hanya mengubah gambar. Waktu sensor maju saat sampel ditambahkan.</p>
            </section>}
            {journey && <div className="journey-progress"><span>{sim.planted ? `HST ${day} / ${maxDay}` : 'Bibit siap ditanam'}</span><progress aria-label="Perjalanan tanam" max={maxDay} value={day} /><span>{phaseAt(developmentDay, onion)}</span></div>}
          </div>
          <div className="control-stack"><SimulationControls waterStatus={sim.source !== 'manual' ? waterStatus : null} waterPending={undoAvailable} pauseNote={playbackNote} recommendation={recommendation} session={session} running={running} onChange={configureSimulation} onRun={toggleRunning} onAdvance={advance} onPlant={() => { edit(plantSeed(session)); showCareEffect('plant'); setNotice('Bibit ditanam. Waktu simulasi berjalan.'); setPauseNote(''); setRunning(true) }} onWater={() => recordWater(150)} onFeed={() => edit(recordFertilizer(session))} />
            {!journey && sim.source === 'manual' &&
            <SensorControls waterStatus={waterStatus} waterPending={undoAvailable} clock={session.clock} key={session.id} reading={reading} setReading={value => edit({ reading: value })} now={data.now_h} freshPh={session.freshPh} setFreshPh={value => edit({ freshPh: value })} volume={session.volume} setVolume={value => edit({ volume: value })} canAdd={data.samples.length < 10000} onSample={freshPh => {
              try { commit(addSample(data, { ...reading, ph: freshPh ? reading.ph : null, valid: true }), `Sampel baru: indeks ${reading.moisture}, ${reading.temp_c} °C; pH ${freshPh ? reading.ph : 'tidak diukur'}.`, 'data') }
              catch (err) { setError(err instanceof Error ? err.message : 'Sampel gagal') }
            }} onWater={recordWater} onFault={fault} />}
          </div>
        </div>
        <a href="#statistik" className="button statistics-link"><ChartLine aria-hidden="true" />Lihat statistik sesi<ArrowUpRight aria-hidden="true" /></a>
      </div>}

      {page === 'statistics' && <div className="statistics-page">
        <div className="dash">
          <PlantStage crop={data.profile.crop} sub={`${data.profile.media} · ${phaseText}`} status={{ ok: dataGood, text: dataGood ? `Pembacaan valid · ${ageMinutes} menit lalu` : 'Periksa pembacaan' }}
            onion={onion} day={developmentDay} age={day} planted={!journey || sim.planted} moisture={last.moisture} contact={result.decision !== 'PERIKSA_SENSOR'} readings={{
              moisture: { label: 'Kelembapan media', value: last.valid ? last.moisture.toLocaleString('id-ID') : 'Gagal', unit: last.valid ? '/100' : undefined, note: `Acuan air ${low} · basah ${result.evidence.wet}`, alert: !last.valid || last.moisture <= low },
              temperature: { label: 'Suhu tanah', value: last.valid ? one(last.temp_c) : 'Gagal', unit: last.valid ? '°C' : undefined, note: `Acuan panas ${one(data.profile.hot_c)} °C`, alert: !last.valid || last.temp_c >= data.profile.hot_c },
              ph: { label: 'pH zona akar', value: phRow?.ph != null ? one(phRow.ph) : '—', note: !phRow ? 'Belum diukur' : !data.profile.ph_validated ? 'Belum tervalidasi' : phFresh ? 'Tervalidasi' : 'Lebih dari 24 jam lalu' },
            }} />
          <div className="dash-side">
            {waterStatus}
            <TrendCard key={session.id} samples={data.samples} now={data.now_h} low={low} clock={session.clock} />
            <CareCard tone={calm ? 'calm' : blocked ? 'blocked' : 'care'} onOpen={openCare}
              action={awaitingPlant ? 'Bibit siap memulai perjalanan' : result.action}
              reason={awaitingPlant ? 'Tanam untuk memulai waktu, lalu amati perubahan media dan perkembangan tanaman.' : result.reason}
              openLabel={awaitingPlant ? 'Mulai menanam' : 'Buka perawatan'}
              tiles={[
                { icon: slope_per_h !== null && slope_per_h > 0 ? <TrendUp aria-hidden="true" /> : <TrendDown aria-hidden="true" />, label: 'Tren', value: slope_per_h === null ? 'Belum tersedia' : `${slope_per_h > 0 ? '+' : ''}${slope_per_h.toLocaleString('id-ID')} poin/jam` },
                { icon: <Hourglass aria-hidden="true" />, label: 'Menuju acuan air', value: eta_h === null ? 'Tidak diproyeksikan' : `${eta_h.toLocaleString('id-ID')} jam` },
                { icon: <Plant aria-hidden="true" />, label: 'Fase', value: phaseText },
                journey ? { icon: <Leaf aria-hidden="true" />, label: 'Pengingat pupuk', value: sim.feedEveryDays ? `HST ${Math.floor(sim.lastFedAt / 24) + sim.feedEveryDays}` : 'Nonaktif' }
                  : { icon: <Pulse aria-hidden="true" />, label: 'Sampel valid', value: `${validShare}% dari ${data.samples.length}` },
              ]} />
            <SessionClockCard samples={data.samples} date={clockDate(session.clock, data.now_h)} utc={utcLabel(session.clock, data.now_h)} time={clockTime(session.clock, data.now_h).slice(0, 5)}
              state={awaitingPlant ? 'Menunggu bibit ditanam' : running ? 'Timelapse berjalan' : 'Waktu dijeda'} note={playbackNote} rate={sim.rate}
              running={running} disabled={simulationStopped(session)} onToggle={toggleRunning} />
          </div>
        </div>
        <StatisticsDashboard awaitingPlant={awaitingPlant} manual={sim.source === 'manual'} clock={session.clock} key={session.id} data={data} decision={result} logs={session.logs} />
      </div>}
      {page === 'devices' && <DevicePanel key={session.id} clock={session.clock} snapshot={session.deviceSnapshot} onImport={importDevice} />}
      {page === 'ecosystem' && <MiroEcosystemWorkspace activePotCase={data} onApplyProfileVersion={(profile, label) => { applyProfile(profile); setNotice(`Profil terkurasi ${label} diterapkan ke sesi simulator.`) }} />}
      {page === 'profile' && <ProfilePage />}
      {page === 'comparison' && <SessionComparison sessions={book.sessions} activeId={book.activeId} onSnapshot={snapshot} />}
      {page === 'terminal' && <section className="terminal-page" aria-label="Terminal sesi">
        <div className="terminal-page-heading"><div className="decision-code"><Pulse aria-hidden="true" /><span>Keputusan</span><code>{result.decision}</code></div>
          <span className="tag" data-running={running || undefined}>{running ? 'Waktu berjalan' : 'Dijeda'}</span>
          <button className="button" onClick={toggleRunning} disabled={simulationStopped(session)}>{running ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}{running ? 'Jeda' : 'Lanjutkan waktu'}</button></div>
        <TerminalSimulator clock={session.clock} data={data} decision={result} logs={logs} />
        <details className="panel disclosure evidence-detail"><summary><span>Bukti pendukung<small>Respons siram, status pH, dan fase</small></span><CaretRight aria-hidden="true" /></summary><div className="disclosure-body"><p>{result.evidence.watering_response}</p><p>{result.evidence.ph_status}</p><p>Fase ilustrasi: {phase}. Fase profil: {data.profile.phase}. HST tidak mengubah acuan lokal.</p></div></details>
      </section>}
      <footer className="page-footer"><span><i aria-hidden="true" />Simulasi lokal · data sintetis · tanpa perangkat terhubung</span><span>Makalah satu pot · September 2026</span></footer>
    </main>
    </div></div>
    <div className={`toast ${notice ? 'visible' : ''}`} role="status">{notice && <><Check weight="bold" aria-hidden="true" />{notice}</>}</div>
    <ChainProofDialog open={modal === 'proof'} onOpenChange={open => { if (!open) setModal(null) }} record={() => ({ name: `smart-agro-catatan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, text: JSON.stringify(encodeSession(session), null, 2) })} />
    <Dialog open={modal === 'profile'} onOpenChange={open => { if (!open) setModal(null) }}><DialogContent showCloseButton={false} onCloseAutoFocus={restoreModalFocus}><ProfileEditor key={profileVersion} profile={data.profile} onApply={applyProfile} onClose={() => setModal(null)} /></DialogContent></Dialog>
    <Dialog open={modal === 'guide'} onOpenChange={open => { if (!open) setModal(null) }}><DialogContent className="guide-modal" showCloseButton={false} onCloseAutoFocus={restoreModalFocus}><div className="dialog-heading"><span className="dialog-icon"><BookOpenText weight="duotone" aria-hidden="true" /></span><div><DialogTitle>Tentang simulator</DialogTitle><DialogDescription>Asisten perawatan tanaman dalam pot berbasis riwayat sensor.</DialogDescription></div><button className="icon-button" aria-label="Tutup panduan" onClick={() => setModal(null)}><X aria-hidden="true" /></button></div>
      <h3>Alur eksplorasi</h3><ol><li>Pilih salah satu dari 10 skenario makalah.</li><li>Pilih Perjalanan tanam atau Eksperimen. Dashboard memuat grafik. Perbandingan, perangkat, serta terminal punya halaman masing-masing.</li><li>Atur masukan, lalu tambah sampel setiap 30 menit simulasi.</li><li>Catat siraman; masukkan pembacaan baru untuk mengevaluasi respons.</li><li>Ekspor sesi untuk menyimpan input, keputusan, dan log.</li></ol>
      <h3>Tiga parameter, acuan lokal</h3><p>Kelembapan adalah indeks 0–100 hasil acuan media, bukan kadar air volumetrik. Suhu memakai DS18B20. pH berasal dari sesi ukur baru; sampel tanpa pengukuran pH disimpan sebagai null.</p>
      <h3>Mode perjalanan dan sampel</h3><p>Perjalanan dimulai dengan Tanam & mulai. Sesi baru berjalan terus sampai dijeda. Jeda saat perhatian bersifat opsional; saat dilanjutkan, peringatan yang sama tidak langsung menjeda lagi. Waktu sensor, grafik, dan terminal memakai satu timestamp UTC. Zona awal mengikuti perangkat dan bisa diganti manual; HST tetap durasi sejak tanam. Waktu sensor dan HST bergerak bersama; siklus pagi–malam memengaruhi suhu dan pengeringan sintetis. Model perkembangan melambat ketika kondisi media kurang mendukung. Semua dinamika ini untuk latihan, belum divalidasi sebagai model pertumbuhan tanaman. Mode acak menambah variasi, sedangkan manual tersedia di Eksperimen.</p><p>Pupuk memakai jadwal pribadi (0 = nonaktif) dan catatan tindakan. Sensor tidak menentukan kebutuhan/dosis pupuk; catatan tidak mengubah pH, nutrisi, atau pertumbuhan.</p><h3>Batas model</h3><p>Timelapse 0–90 HST untuk cabai dan 0–65 HST untuk bawang hanya menggambarkan fase. Tidak mengubah ambang, memprediksi hasil panen, mengukur EC/NPK, mendiagnosis penyakit, atau menentukan dosis pupuk dan dolomit.</p><p>Proyeksi kering memakai regresi linear lokal, minimal 6 sampel selama 2,5 jam, R² ≥0,8, dan horizon maksimal 12 jam. Bukan waktu siram pasti.</p><p>Sesi disimpan otomatis di browser ini. Refresh memulihkan sesi aktif dalam keadaan dijeda. Ganti skenario membuat sesi baru; riwayat sebelumnya tetap tersedia pada Bandingkan sesi. Ekspor versi baru memulihkan draf, log, serta posisi ilustrasi saat diimpor. Kasus Python tetap didukung. Simpanan tidak tersinkron antarperangkat atau alamat hosting; gunakan ekspor JSON untuk memindahkannya.</p>
      <p className="source-note">Sumber: Makalah_Asisten_Perawatan_Tanaman_Satu_Pot.docx, Bab V, dan simulasi_pot.py. Semua skenario sintetis; belum divalidasi pada tanaman atau perangkat aktual.</p>
    </DialogContent></Dialog>
    {printSession && <SessionReport session={printSession} />}
  </>
}

export default function App() {
  return <AccountProvider><Simulator /></AccountProvider>
}
