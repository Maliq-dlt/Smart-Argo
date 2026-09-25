import * as Tabs from '@radix-ui/react-tabs'
import { Check, Copy, Terminal, CircleCheck, CornerDownRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { RULES, type Decision, type PotCase } from '../lib/agronomyEngine'
import { clockTime, clockDate, logClock, utcLabel, instantAt, type SessionClock } from '../lib/sessionClock'
import type { LogEntry } from '../lib/sessionStore'

export default function TerminalSimulator({ clock, data, decision, logs }: { clock: SessionClock; data: PotCase; decision: Decision; logs: LogEntry[] }) {
  const [tab, setTab] = useState('serial'), tabId = useId(), reduced = useReducedMotion()
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('')
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { const pane = logEnd.current?.parentElement; if (pane) pane.scrollTop = pane.scrollHeight }, [logs])
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer) } }, [copied])
  const payload = { source: 'simulasi_sintetis', device_id: 'AGRO-NODE-01', clock, time_utc: new Date(instantAt(clock, data.now_h)).toISOString(), input: data, output: decision }
  const current = RULES.findIndex(r => r[0] === decision.decision)
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); setCopied(true); setCopyError('') }
    catch { setCopyError('Salin gagal. Gunakan tombol Ekspor sesi.') }
  }
  return <section className="terminal-panel" aria-labelledby="terminal-heading">
    <div className="terminal-heading"><h2 id="terminal-heading"><Terminal />Konsol simulasi</h2><span>ESP32</span></div>
    <Tabs.Root value={tab} onValueChange={setTab} className="terminal-tabs">
      <Tabs.List className="tab-list" aria-label="Tampilan konsol">
        {[['serial', 'Log sesi'], ['json', 'JSON'], ['trace', 'Jejak aturan']].map(([value, label]) => <Tabs.Trigger key={value} value={value}>
          {tab === value && <motion.span className="segment-selection" layoutId={`${tabId}-tab`} initial={false} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }} aria-hidden="true" />}<span className="segment-label">{label}</span>
        </Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="serial" className="terminal-content">
        <div className="terminal-meta"><span>AGRO-NODE-01 / P1</span><span>{clockDate(clock, data.now_h)} {clockTime(clock, data.now_h)} · {utcLabel(clock, data.now_h)}</span></div>
        <div className="log-lines" tabIndex={0} role="region" aria-label="Log tindakan dan pembacaan">
          <p className="boot-line">Smart Agro · simulator keputusan v1.4</p>
          <p className="boot-line">Sumber: makalah satu pot / Bab V</p>
          <p className="boot-line">Kapasitif · DS18B20 · pH + DMS</p>
          <p className="log-divider">────────────────────────────</p>
          {logs.map(log => <div key={log.id} className={`log-line ${log.kind}`}><time>{logClock(clock, log.time)}</time><span><b>{log.kind.toUpperCase()}</b> {log.message}</span></div>)}
          <div ref={logEnd} />
        </div>
        <div className="terminal-prompt"><CornerDownRight /><span>Menunggu sampel berikutnya</span><i /></div>
      </Tabs.Content>
      <Tabs.Content value="json" className="terminal-content">
        <div className="terminal-meta"><span>Kontrak input + keputusan</span><button onClick={copy} className="copy-button" aria-label="Salin JSON">{copied ? <Check /> : <Copy />}{copied ? 'Tersalin' : 'Salin'}</button></div>
        {copyError && <p role="alert">{copyError}</p>}
        <pre tabIndex={0} aria-label="Payload JSON">{JSON.stringify(payload, null, 2)}</pre>
      </Tabs.Content>
      <Tabs.Content value="trace" className="terminal-content">
        <div className="terminal-meta">Aturan pertama yang cocok menentukan tindakan.</div>
        <ol className="rule-list">{RULES.map(([code, label, detail], i) => <li key={code} className={i === current ? 'matched' : i > current ? 'skipped' : ''}>
          <span className="rule-number">{i < current ? <CircleCheck size={13} /> : String(i + 1).padStart(2, '0')}</span>
          <div><strong>{label}</strong><small>{i === current ? decision.reason : detail}</small><em>{i === current ? 'TERPILIH' : i > current ? 'TIDAK DIEVALUASI' : 'TIDAK MEMICU'}</em></div>
        </li>)}</ol>
      </Tabs.Content>
    </Tabs.Root>
    <div className="terminal-footer"><span><i />Tidak terhubung perangkat</span><span>{logs.length} / 500 log</span></div>
  </section>
}
