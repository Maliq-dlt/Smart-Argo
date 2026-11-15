import { Check, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { DialogDescription, DialogTitle } from '../ui/dialog'
import SpeciesSearch from './SpeciesSearch'
import type { Outcome } from '../../lib/garden'

const OUTCOMES: { value: Outcome; label: string }[] = [{ value: 'berhasil', label: 'Berhasil' }, { value: 'gagal', label: 'Gagal' }, { value: 'dihentikan', label: 'Dihentikan' }]

/** Replacing a plant closes its cycle: the dates and the outcome stay in the history, and the new plant begins at day 0. The
 * dialog says so before anything is done. */
export default function SwitchPlantDialog({ slotName, current, today, onSwitch, onClose }: {
  slotName: string; current: { nickname: string; speciesName: string; plantedOn: string } | null; today: string
  onSwitch: (change: { speciesId: number; outcome: Outcome; nickname?: string }) => void; onClose: () => void
}) {
  const [speciesId, setSpeciesId] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<Outcome>('dihentikan')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  return <form className="profile-form garden-wizard" onSubmit={event => {
    event.preventDefault()
    if (speciesId === null) { setError('Pilih tanaman pengganti dulu.'); return }
    try { onSwitch({ speciesId, outcome, nickname: nickname.trim() || undefined }) } catch (err) { setError(err instanceof Error ? err.message : 'Tidak dapat mengganti.') }
  }}>
    <div className="dialog-heading"><div><DialogTitle>Ganti tanaman di {slotName}</DialogTitle>
      <DialogDescription>{current
        ? `Siklus ${current.nickname} (${current.speciesName}, ditanam ${current.plantedOn}) ditutup hari ini, ${today}. Riwayatnya tetap tersimpan dan tidak diubah. Tanaman baru mulai dari hari 0.`
        : 'Slot ini kosong. Tanaman baru mulai dari hari 0.'}</DialogDescription></div>
      <button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><X /></button></div>
    {current && <fieldset className="garden-outcome"><legend>Bagaimana siklus {current.nickname} berakhir?</legend>
      {OUTCOMES.map(item => <label key={item.value} className="check-label"><input type="radio" name="outcome" value={item.value} checked={outcome === item.value} onChange={() => setOutcome(item.value)} />{item.label}</label>)}
    </fieldset>}
    <SpeciesSearch label="Tanaman pengganti" value={speciesId} onChange={setSpeciesId} />
    <label>Nama panggilan<input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={60} placeholder="Kosongkan untuk nama otomatis" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button type="submit" className="button primary"><Check aria-hidden="true" />Ganti tanaman</button>
  </form>
}
