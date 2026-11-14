import { ArrowRight } from '@phosphor-icons/react'
import { useState } from 'react'
import AgroMark from './AgroMark'
import Mascot from './Mascot'
import ThemeToggle from './ThemeToggle'
import { useAccount } from './accountContext'
import type { PotSetup as Pot } from '../lib/productAccountClient'
import scenarios from '../lib/scenarios.json'

/** The simulator profile each choice opens, as the app's own "Pot baru" does (scenarios.json 0 = cabai, 7 = bawang). */
const POT_SCENARIO: Record<Pot['crop'], number> = { cabai: 0, bawang: 7 }
const crops = (Object.keys(POT_SCENARIO) as Pot['crop'][]).map(id => ({ id, profile: scenarios[POT_SCENARIO[id]].profile }))

/** Step 2 after signing in (Google or email): name the first pot, pick its crop, say whether a unit is on hand.
 * Asked once; saved on the account. */
export default function PotSetup({ onSaved }: { onSaved: (pot: Pot) => void }) {
  const account = useAccount()
  const [name, setName] = useState(''), [crop, setCrop] = useState<Pot['crop']>('cabai'), [device, setDevice] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false)
  const first = account.identity?.name.split(' ')[0]

  async function save() {
    const pot = { name: name.trim() || `Pot ${crops.find(c => c.id === crop)!.profile.crop.toLowerCase()}`, crop, device }
    setBusy(true); setError('')
    try {
      await account.client!.savePot(pot)
      setDone(true)
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => window.setTimeout(resolve, 700))
      onSaved(pot)
      await account.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Pot belum tersimpan. Coba lagi.') }
    finally { setBusy(false) }
  }

  return <main id="main" tabIndex={-1} className="entry-gate" aria-label="Siapkan pot">
    <header className="entry-top"><span className="entry-home"><AgroMark /><span>Smart Agro</span></span><ThemeToggle /></header>
    <div className="entry-card">
      {error && <p className="entry-notice" role="alert">{error}</p>}
      <div className="signin">
        <div className="signin-guard">
          <Mascot className="guardian" face={done ? 'happy' : busy ? 'think' : 'smile'} look={{ x: .4, y: .5 }} bud={done} />
          <p aria-hidden="true">{done ? 'Pot siap. Ayo mulai!' : `Halo${first ? `, ${first}` : ''}! Pot apa yang kita rawat?`}</p>
        </div>
        <form className="signin-body" onSubmit={event => { event.preventDefault(); void save() }}>
          <h3>Siapkan pot pertama</h3>
          <p className="signin-lede">Pilihan ini membuka perjalanan tanam Anda dengan profil acuan tanaman yang sesuai.</p>
          <fieldset className="signin-fields" disabled={busy || done}>
            <legend className="sr-only">Data pot</legend>
            <label className="miro-field"><span>Nama pot</span><input value={name} maxLength={40} autoComplete="off" placeholder="Misalnya: Cabai balkon" onChange={e => setName(e.target.value)} /></label>
            <fieldset className="pot-choice">
              <legend>Tanaman</legend>
              {crops.map(({ id, profile }) => <label key={id} className="pot-option">
                <input type="radio" name="crop" checked={crop === id} onChange={() => setCrop(id)} />
                <span><b>{profile.crop}</b><small>{profile.media} · fase {profile.phase.toLowerCase()}</small></span>
              </label>)}
            </fieldset>
            <fieldset className="pot-choice">
              <legend>Perangkat Smart Agro</legend>
              <label className="pot-option"><input type="radio" name="device" checked={!device} onChange={() => setDevice(false)} /><span><b>Belum ada</b><small>Mulai dengan simulasi</small></span></label>
              <label className="pot-option"><input type="radio" name="device" checked={device} onChange={() => setDevice(true)} /><span><b>Sudah ada</b><small>Aktifkan dengan nomor seri</small></span></label>
            </fieldset>
            <button className="button primary signin-submit" type="submit">{device ? 'Simpan, lalu aktifkan perangkat' : 'Simpan dan mulai'}<ArrowRight aria-hidden="true" /></button>
          </fieldset>
          <ol className="signin-steps" aria-label="Langkah memulai">
            <li>Masuk</li><li aria-current="step">Siapkan pot</li><li>Amankan akun dengan 2FA</li>
          </ol>
        </form>
      </div>
    </div>
  </main>
}
