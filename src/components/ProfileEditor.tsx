import { DialogTitle, DialogDescription } from './ui/dialog'
import type { Profile } from '../lib/agronomyEngine'
import { useState } from 'react'
import { Check, X } from 'lucide-react'

export default function ProfileEditor({ profile, onApply, onClose }: { profile: Profile; onApply: (p: Profile) => void; onClose: () => void }) {
  const [error, setError] = useState('')
  return <form className="profile-form" onSubmit={e => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const observations = (key: string) => String(form.get(key)).split(',').map(v => v.trim() ? Number(v.trim()) : NaN)
    try { onApply({ ...profile, media: String(form.get('media')), needs_water: observations('needs_water'), drained: observations('drained'),
      next_visit_h: Number(form.get('next_visit_h')), hot_c: Number(form.get('hot_c')),
      ph_range: [Number(form.get('ph_min')), Number(form.get('ph_max'))], validated: form.has('validated'), ph_validated: form.has('ph_validated') }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Profil tidak valid') }
  }}>
    <div className="dialog-heading"><div><DialogTitle>Acuan lokal pot P1</DialogTitle><DialogDescription>Angka demonstrasi. Validasi lapangan tetap diperlukan.</DialogDescription></div><button type="button" className="icon-button" aria-label="Tutup acuan lokal" onClick={onClose}><X /></button></div>
    <label>Nama media<input name="media" defaultValue={profile.media} maxLength={120} required /></label>
    <label>Observasi saat perlu air<input name="needs_water" defaultValue={profile.needs_water.join(', ')} required /><small>Minimal 3 observasi 0–100, pisahkan dengan koma.</small></label>
    <label>Observasi setelah drainase<input name="drained" defaultValue={profile.drained.join(', ')} required /><small>Median drainase minimal 10 poin di atas median perlu air.</small></label>
    <div className="form-grid"><label>Kunjungan berikutnya (jam)<input name="next_visit_h" type="number" min=".1" max="24" step=".1" defaultValue={profile.next_visit_h} required /></label><label>Acuan panas (°C)<input name="hot_c" type="number" min="20" max="60" step=".1" defaultValue={profile.hot_c} required /></label>
      <label>pH minimum<input name="ph_min" type="number" min="0" max="14" step=".1" defaultValue={profile.ph_range[0]} required /></label><label>pH maksimum<input name="ph_max" type="number" min="0" max="14" step=".1" defaultValue={profile.ph_range[1]} required /></label></div>
    <label className="check-label"><input type="checkbox" name="validated" defaultChecked={profile.validated} />Acuan lokal disahkan untuk simulasi</label>
    <label className="check-label"><input type="checkbox" name="ph_validated" defaultChecked={profile.ph_validated} />Pengukuran pH tervalidasi untuk simulasi</label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <p className="section-hint">Mengganti media memulai sesi baru. Sesi sebelumnya tetap tersedia di Lanjutkan sesi.</p>
    <button type="submit" className="button primary"><Check />Terapkan acuan</button>
  </form>
}
