import { ArrowUpRight, ArrowsClockwise, BookBookmark, Check, LinkSimple, Medal, Plant, Plus, QrCode, Robot, ShieldCheck, Sun, Warning } from '@phosphor-icons/react'
import ProductTelemetry from './ProductTelemetry'
import ProductKnowledge from './ProductKnowledge'
import ProductEnergy from './ProductEnergy'
import ProductRewards from './ProductRewards'
import { useAccount } from './accountContext'
import ProductQrCode from './ProductQrCode'
import QrScanner from './QrScanner'
import { SelectField } from './ui/select'
import { useEffect, useState } from 'react'
import type { PotCase, Profile } from '../lib/agronomyEngine'
import {
  type EcosystemState,
  type MascotState,
  readEcosystemState,
  saveEcosystemState,
  createInitialEcosystemState,
  inspectPublicQr,
  issueActivationNonce,
  claimProductActivation,
  transferOwnership,
  registerProductManifest,
  revokeProductOrDevice,
  createProductUnit,
  ingestDeviceMeasurement,
  evaluateUnitWithMascot,
  generateAiSnapshot,
  calculateSolarBatterySizing,
  recordEnergyWindow,
  getAccountPointSummary,
  claimGardeningReward,
  requestCatalogRedemption,
  cancelCatalogRedemption,
  fulfillCatalogRedemption,
  compensateLedgerEntry,
  submitProfileContribution,
  reviewProfileContribution,
  processOutboxJob,
  verifyBlockchainCommitment,
} from '../lib/miroProductEngine'

type SectionTab = 'identity' | 'units' | 'mascot' | 'energy' | 'community'

function MascotAvatar({ state }: { state: MascotState }) {
  const mouthPath =
    state === 'tenang_senang'
      ? 'M68 108Q80 120 92 108'
      : state === 'sedih_perhatian'
        ? 'M68 115Q80 105 92 115'
        : state === 'waspada_marah'
          ? 'M70 113H90'
          : 'M74 111Q80 107 86 112'
  return (
    <svg viewBox="0 0 160 146" className="miro-mascot-svg" aria-hidden="true">
      <ellipse cx="80" cy="133" rx="42" ry="5" fill="var(--forest-line)" />
      <path d="M80 81V44" fill="none" stroke="var(--stem)" strokeWidth="4" strokeLinecap="round" />
      <path d="M80 63C52 63 44 42 48 27C70 29 83 42 80 63Z" fill="var(--leaf-light)" />
      <path d="M80 51C81 30 96 19 115 23C115 45 102 56 80 51Z" fill="var(--leaf)" />
      <path d="M44 78H116L108 122Q80 136 52 122Z" fill="var(--pot)" />
      <rect x="41" y="73" width="78" height="12" rx="5" fill="var(--pot-light)" />
      {state === 'waspada_marah' && (
        <path d="M60 91L71 95M100 91L89 95" stroke="var(--soil-wet)" strokeWidth="2.5" strokeLinecap="round" />
      )}
      <circle cx="66" cy="99" r="2.8" fill="var(--soil-wet)" />
      <circle cx="94" cy="99" r="2.8" fill="var(--soil-wet)" />
      <path d={mouthPath} fill="none" stroke="var(--soil-wet)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export default function MiroEcosystemWorkspace({
  activePotCase,
  onApplyProfileVersion,
}: {
  activePotCase: PotCase
  onApplyProfileVersion: (profile: Profile, label: string) => void
}) {
  const [eco, setEco] = useState<EcosystemState>(() =>
    readEcosystemState(window.localStorage, activePotCase.profile)
  )
  const [tab, setTab] = useState<SectionTab>('identity')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // State form Tab 1: QR & Aktivasi
  const [qrSerial, setQrSerial] = useState('AGRO-KIT-POT-001')
  const [sealedCode, setSealedCode] = useState('SEALED-POT-001-SECRET')
  const [newSerial, setNewSerial] = useState('AGRO-KIT-POT-009')
  const [newVariant, setNewVariant] = useState<'single_pot' | 'garden'>('single_pot')
  const [newSealed, setNewSealed] = useState('SEALED-POT-009-SECRET')

  // State form Tab 2: Unit & Ingest Sensor
  const [selectedProductId, setSelectedProductId] = useState('prod-garden-001')
  const [newUnitLabel, setNewUnitLabel] = useState('Bedeng B · Cabai Rawit Barat')
  const [seqNumber, setSeqNumber] = useState(101)
  const [sensorKind, setSensorKind] = useState<'moisture' | 'soil_temperature' | 'soil_ph'>('moisture')
  const [sensorStatus, setSensorStatus] = useState<'ok' | 'error' | 'not_measured'>('ok')
  const [sensorValue, setSensorValue] = useState('64')

  // State form Tab 3: Maskot 2D & AI Snapshot
  const [aiQuestion, setAiQuestion] = useState('Apakah media perlu disiram atau dikocor dolomit hari ini?')
  const [aiMode, setAiMode] = useState<'verified' | 'stale_contradiction' | 'timeout'>('verified')

  // State form Tab 4: Energi Surya & Reward
  const [sleepW, setSleepW] = useState(0.15)
  const [activeW, setActiveW] = useState(1.8)
  const [activeHours, setActiveHours] = useState(2)
  const [autonomyDays, setAutonomyDays] = useState(3)
  const [peakSunHours, setPeakSunHours] = useState(4.2)
  const [socPct, setSocPct] = useState(86)
  const [energySourceMode, setEnergySourceMode] = useState<'verified_meter' | 'simulated'>('verified_meter')

  // State form Tab 5: Komunitas & Blockchain
  const [contribLicense, setContribLicense] = useState('CC-BY-4.0 · Kalibrasi gravimetri & pH buffer 3 titik')
  const [contribEvidence, setContribEvidence] = useState('dataset://smart-agro/bandung-polybag-2026')
  const [contribHotC, setContribHotC] = useState(String(activePotCase.profile.hot_c))
  const [contribNotes, setContribNotes] = useState('Penyesuaian ambang suhu kanopi cabai rawit fase generatif.')
  const [reviewReason, setReviewReason] = useState('Bukti kalibrasi dan rentang parameter terverifikasi.')

  useEffect(() => {
    try {
      saveEcosystemState(window.localStorage, eco)
    } catch {
      // Abaikan bila storage penuh; state di memori tetap berjalan
    }
  }, [eco])

  const account = useAccount()
  const online = account.signedIn && account.client ? { client: account.client, onSessionExpired: account.expire } : null
  const activeAccount = eco.accounts.find(a => a.id === eco.activeAccountId) ?? eco.accounts[0]
  const qrCheck = inspectPublicQr(eco, qrSerial)
  const currentUnit = eco.units[0]
  const mascotEval = evaluateUnitWithMascot(activePotCase)
  const pointSummary = getAccountPointSummary(eco, activeAccount.id)

  const sleepHours = Math.max(0, 24 - activeHours)
  const sizing = calculateSolarBatterySizing({
    modes: [
      { name: 'Tidur / siaga', powerW: sleepW, hoursPerDay: sleepHours },
      { name: 'Ukur & transmisi', powerW: activeW, hoursPerDay: activeHours },
    ],
    autonomyDays,
    usableDepthOfDischarge: 0.8,
    batteryPathEfficiency: 0.9,
    peakSunHours,
    solarSystemEfficiency: 0.75,
    batteryNominalVoltageV: 12,
    currentSocPct: socPct,
  })

  function notifyOk(text: string) {
    setFeedback({ kind: 'ok', text })
  }
  function notifyErr(err: unknown) {
    setFeedback({ kind: 'error', text: err instanceof Error ? err.message : 'Operasi gagal.' })
  }

  return (
    <div className="miro-ecosystem" aria-label="Ekosistem produk Smart Agro sesuai rancangan Miro">
      <p className="section-hint">{online ? 'Data akun Anda tampil paling atas di tiap tab. Sisanya simulasi rancangan Miro, bukan transaksi online.' : 'Simulasi lokal: seluruh peran, AI, reward, dan blockchain di bawah adalah demonstrasi, bukan akun atau transaksi online.'}</p>
      <section className="panel miro-statusbar" aria-label="Konteks akun dan ringkasan ekosistem">
        <div className="miro-account-bar">
          <div>
            <h2>Peran dan akun demo<small className="miro-code">U02–U05 · E02–E04 · A04–A10</small></h2>
            <p className="section-hint">
              Pilih peran untuk menguji otorisasi pemilik, kontributor, kurator agronomi, dan operator program.
            </p>
          </div>
          <div className="miro-account-controls">
            <label className="miro-field-inline">
              <span>Akun aktif</span>
              <SelectField label="Pilih akun aktif" value={activeAccount.id} onValueChange={value => { setEco(prev => ({ ...prev, activeAccountId: value })); setFeedback(null) }} options={eco.accounts.map(acc => ({ value: acc.id, label: `${acc.displayName} (${acc.roles.join(', ')})` }))} />
            </label>
            <button
              type="button"
              className="button"
              onClick={() => {
                setEco(createInitialEcosystemState(activePotCase.profile))
                notifyOk('Data ekosistem direset ke kondisi awal.')
              }}
            >
              <ArrowsClockwise /> Reset demo
            </button>
          </div>
        </div>
        <dl className="miro-kpi-strip">
          <div>
            <dt>Produk terdaftar</dt>
            <dd>{eco.products.length} kit</dd>
          </div>
          <div>
            <dt>Unit pot / zona</dt>
            <dd>{eco.units.length} unit</dd>
          </div>
          <div>
            <dt>Saldo poin resmi</dt>
            <dd>{pointSummary.availablePoints} poin</dd>
          </div>
          <div>
            <dt>Saldo demo (simulasi)</dt>
            <dd>{pointSummary.demoPoints} poin</dd>
          </div>
          <div>
            <dt>Versi profil terbit</dt>
            <dd>v{eco.profileVersions.at(-1)?.version ?? 1}</dd>
          </div>
        </dl>
      </section>

      {feedback && (
        <div
          className={`miro-feedback ${feedback.kind === 'error' ? 'is-error' : 'is-ok'}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.kind === 'error' ? <Warning /> : <Check />}
          <span>{feedback.text}</span>
        </div>
      )}

      <nav className="miro-tabs" aria-label="Modul ekosistem Miro">
        {(
          [
            ['identity', 'QR & kepemilikan', QrCode],
            ['units', 'Unit & sensor', Plant],
            ['mascot', 'Maskot & AI', Robot],
            ['energy', 'Energi & reward', Sun],
            ['community', 'Kurasi & blockchain', BookBookmark],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'is-active' : undefined}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id)
              setFeedback(null)
            }}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      {tab === 'identity' && (
        <div className="miro-grid">
          <section className="panel miro-card" aria-labelledby="qr-verify-heading">
            <div className="panel-heading">
              <h2 id="qr-verify-heading">
                <QrCode weight="duotone" aria-hidden="true" />Periksa QR dan aktivasi sekali pakai<small className="miro-code">ID-01 · ID-02 · A04</small>
              </h2>
              <span className="tag">{qrCheck.verifiedRegistry ? 'TERDAFTAR' : 'PERIKSA'}</span>
            </div>
            <div className="miro-card-body">
              <div className="miro-qr-pick">
                <label className="miro-field">
                  <span>Nomor seri QR publik</span>
                  <SelectField label="Pilih nomor seri QR publik" value={qrSerial} onValueChange={setQrSerial} options={eco.products.map(p => ({ value: p.serialPublic, label: `${p.serialPublic} · ${p.variant === 'single_pot' ? 'Kit 1 pot' : 'Kit 1 kebun'} (${p.registryStatus})` }))} />
                </label>
                <QrScanner onSerial={(serial, warning) => {
                  if (!eco.products.some(p => p.serialPublic === serial)) { notifyErr(new Error(`QR terbaca (${serial}), tetapi seri itu tidak ada di registri demo.`)); return }
                  setQrSerial(serial)
                  notifyOk(warning ? `QR ${serial} terbaca. ${warning}` : `QR ${serial} terbaca dari kamera atau foto.`)
                }} />
              </div>
              {qrCheck.found && <ProductQrCode serial={qrCheck.serialPublic} />}
              <div className="miro-callout">
                <strong>Status Registri: {qrCheck.registryStatus.toUpperCase()}</strong>
                <p>{qrCheck.physicalNotice}</p>
                <small>
                  Varian: <code>{qrCheck.variant}</code> · Kunci perangkat: <code>{qrCheck.devicePublicKey || '—'}</code> ·
                  Kepemilikan aktif: <strong>{qrCheck.hasActiveOwner ? 'Sudah dimiliki' : 'Belum diklaim'}</strong>
                </small>
              </div>
              <label className="miro-field">
                <span>Kode aktivasi tersegel (kemasan gosok)</span>
                <input
                  type="text"
                  value={sealedCode}
                  onChange={e => setSealedCode(e.target.value)}
                  placeholder="SEALED-POT-001-SECRET"
                />
              </label>
              <div className="miro-actions-row">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    try {
                      if (!qrCheck.found) throw new Error('Produk tidak ditemukan.')
                      const issued = issueActivationNonce(eco, {
                        accountId: activeAccount.id,
                        productId: qrCheck.productId,
                        sessionId: 'web-session',
                      })
                      const claimed = claimProductActivation(issued.state, {
                        accountId: activeAccount.id,
                        productId: qrCheck.productId,
                        sealedCode,
                        nonceId: issued.nonce.id,
                        deviceSignature: `sig:${qrCheck.devicePublicKey}:${issued.nonce.token}`,
                      })
                      setEco(claimed.state)
                      notifyOk(
                        `Aktivasi ${qrCheck.serialPublic} berhasil dalam 1 transaksi atomik. Pekerjaan outbox ${claimed.outboxJob.id} dibuat.`
                      )
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  <ShieldCheck weight="duotone" aria-hidden="true" />Klaim dengan Nonce & Kode Tersegel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    try {
                      if (!qrCheck.found) throw new Error('Produk tidak ditemukan.')
                      const recipient = eco.accounts.find(a => a.id !== activeAccount.id) ?? eco.accounts[0]
                      const res = transferOwnership(eco, {
                        productId: qrCheck.productId,
                        fromAccountId: activeAccount.id,
                        toAccountId: recipient.id,
                        reauthenticated: true,
                      })
                      setEco(res.state)
                      notifyOk(`Kepemilikan ${qrCheck.serialPublic} ditransfer ke ${recipient.displayName} (ID-03).`)
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  Transfer Kepemilikan (ID-03)
                </button>
              </div>
            </div>
          </section>

          <section className="panel miro-card" aria-labelledby="operator-registry-heading">
            <div className="panel-heading">
              <h2 id="operator-registry-heading">
                <ShieldCheck weight="duotone" aria-hidden="true" />Registri penerbit dan pencabutan<small className="miro-code">ID-04 · ID-05</small>
              </h2>
              <span className="tag">PERAN: OPERATOR</span>
            </div>
            <div className="miro-card-body">
              <p className="section-hint">
                Operator penerbit mendaftarkan manifest bertanda tangan atau mencabut perangkat yang bocor tanpa menghapus riwayat audit.
              </p>
              <div className="miro-form-two">
                <label className="miro-field">
                  <span>Serial publik baru</span>
                  <input type="text" value={newSerial} onChange={e => setNewSerial(e.target.value)} />
                </label>
                <label className="miro-field">
                  <span>Varian produk</span>
                  <SelectField label="Varian produk baru" value={newVariant} onValueChange={value => setNewVariant(value as 'single_pot' | 'garden')} options={[{ value: 'single_pot', label: 'Satu produk, satu pot' }, { value: 'garden', label: 'Satu produk, satu kebun' }]} />
                </label>
              </div>
              <label className="miro-field">
                <span>Kode aktivasi tersegel baru (disimpan sebagai SHA-256 hash)</span>
                <input type="text" value={newSealed} onChange={e => setNewSealed(e.target.value)} />
              </label>
              <div className="miro-actions-row">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    try {
                      const res = registerProductManifest(eco, {
                        operatorAccountId: activeAccount.id,
                        serialPublic: newSerial,
                        variant: newVariant,
                        sealedCode: newSealed,
                        devicePublicKey: `pubkey:esp32-${newSerial.toLowerCase()}`,
                      })
                      setEco(res.state)
                      setQrSerial(res.product.serialPublic)
                      notifyOk(`Produk ${res.product.serialPublic} didaftarkan dan manifest masuk antrian outbox.`)
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  <Plus /> Daftarkan Produk (ID-04)
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    try {
                      if (!qrCheck.found) throw new Error('Pilih produk yang terdaftar.')
                      const res = revokeProductOrDevice(eco, {
                        operatorAccountId: activeAccount.id,
                        productId: qrCheck.productId,
                        reason: 'Dilaporkan bocor / dicabut oleh operator',
                      })
                      setEco(res.state)
                      notifyOk(`Identitas produk ${qrCheck.serialPublic} dicabut dengan jejak audit (ID-05).`)
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  Cabut Produk Terpilih (ID-05)
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {online && tab === 'units' && <div className="online-panel"><ProductTelemetry {...online} products={account.products} /></div>}
      {tab === 'units' && (
        <div className="miro-grid">
          <section className="panel miro-card" aria-labelledby="units-variant-heading">
            <div className="panel-heading">
              <h2 id="units-variant-heading">
                <Plant weight="duotone" aria-hidden="true" />Kit satu pot dan kit satu kebun<small className="miro-code">APP-02 · E02</small>
              </h2>
              <span className="tag">{eco.units.length} UNIT AKTIF</span>
            </div>
            <div className="miro-card-body">
              <p className="section-hint">
                Kit satu pot dibatasi maksimal 1 unit aktif. Kit satu kebun mendukung beberapa zona/bedeng dengan profil tanaman berbeda.
              </p>
              <label className="miro-field">
                <span>Pilih produk milik akun</span>
                <SelectField label="Pilih produk untuk tambah unit" value={selectedProductId} onValueChange={setSelectedProductId} options={eco.products.map(p => ({ value: p.id, label: `${p.serialPublic} · ${p.variant === 'single_pot' ? '1 pot, maks. 1 unit' : '1 kebun, multi-zona'}` }))} />
              </label>
              <label className="miro-field">
                <span>Label lokasi pot / zona kebun baru</span>
                <input type="text" value={newUnitLabel} onChange={e => setNewUnitLabel(e.target.value)} />
              </label>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  try {
                    const res = createProductUnit(eco, {
                      accountId: activeAccount.id,
                      productId: selectedProductId,
                      profileVersionId: eco.profileVersions.at(-1)!.id,
                      locationLabel: newUnitLabel,
                    })
                    setEco(res.state)
                    notifyOk(`Unit "${res.unit.locationLabel}" berhasil ditambahkan.`)
                  } catch (err) {
                    notifyErr(err)
                  }
                }}
              >
                <Plus /> Tambah Unit / Zona (APP-02)
              </button>
              <ul className="miro-list">
                {eco.units.map(u => {
                  const prod = eco.products.find(p => p.id === u.productId)
                  const pver = eco.profileVersions.find(v => v.id === u.profileVersionId)
                  return (
                    <li key={u.id}>
                      <div>
                        <strong>{u.locationLabel}</strong>
                        <small>
                          Produk: {prod?.serialPublic} ({prod?.variant}) · Profil: {pver?.parametersAndScope.crop} (v
                          {pver?.version})
                        </small>
                      </div>
                      <span className="tag">{prod?.variant === 'single_pot' ? '1 POT' : 'ZONA KEBUN'}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>

          <section className="panel miro-card" aria-labelledby="measurement-ingest-heading">
            <div className="panel-heading">
              <h2 id="measurement-ingest-heading">
                Ingest pengukuran dan deduplikasi paket<small className="miro-code">APP-03 · E02</small>
              </h2>
              <span className="tag">{eco.measurements.length} SAMPEL</span>
            </div>
            <div className="miro-card-body">
              <p className="section-hint">
                Kunci unik <code>(device_id, boot_id, sequence, sensor_id)</code> mencegah duplikasi saat perangkat reconnect. Status selain <code>ok</code> wajib memakai <code>null</code>.
              </p>
              <div className="miro-form-three">
                <label className="miro-field">
                  <span>Sequence #</span>
                  <input
                    type="number"
                    value={seqNumber}
                    onChange={e => setSeqNumber(Number(e.target.value))}
                  />
                </label>
                <label className="miro-field">
                  <span>Sensor</span>
                  <SelectField label="Jenis sensor" value={sensorKind} onValueChange={value => setSensorKind(value as typeof sensorKind)} options={[{ value: 'moisture', label: 'Kelembapan (0–100)' }, { value: 'soil_temperature', label: 'Suhu tanah (−20–60 °C)' }, { value: 'soil_ph', label: 'pH tanah (0–14)' }]} />
                </label>
                <label className="miro-field">
                  <span>Status kualitas</span>
                  <SelectField label="Status kualitas sensor" value={sensorStatus} onValueChange={value => setSensorStatus(value as typeof sensorStatus)} options={[{ value: 'ok', label: 'ok · nilai valid' }, { value: 'error', label: 'error · nilai wajib kosong' }, { value: 'not_measured', label: 'not_measured · nilai wajib kosong' }]} />
                </label>
              </div>
              <label className="miro-field">
                <span>Nilai ukur (otomatis null jika status bukan ok)</span>
                <input
                  type="number"
                  disabled={sensorStatus !== 'ok'}
                  value={sensorValue}
                  onChange={e => setSensorValue(e.target.value)}
                />
              </label>
              <div className="miro-actions-row">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    try {
                      const unit = eco.units[0]
                      const device = eco.devices.find(d => d.productId === unit.productId)!
                      const res = ingestDeviceMeasurement(eco, {
                        deviceId: device.id,
                        unitId: unit.id,
                        bootId: 'boot-2026-01',
                        sequence: seqNumber,
                        sensorId: sensorKind,
                        source: 'device',
                        qualityStatus: sensorStatus,
                        value: sensorStatus === 'ok' ? Number(sensorValue) : null,
                        measuredAtMs: Date.now(),
                      })
                      setEco(res.state)
                      notifyOk(
                        res.deduplicated
                          ? `Paket duplikat terdeteksi (${res.measurement.deviceBootSeqSensor}) — diabaikan tanpa menggandakan data.`
                          : `Pengukuran ${res.measurement.deviceBootSeqSensor} berhasil disimpan.`
                      )
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  Kirim Paket Telemetri
                </button>
              </div>
              {eco.measurements.length > 0 && (
                <ul className="miro-list">
                  {eco.measurements.slice(-4).reverse().map(m => (
                    <li key={m.id}>
                      <div>
                        <strong>{m.deviceBootSeqSensor}</strong>
                        <small>
                          Status: {m.qualityStatus} · Nilai: {m.valueNullable ?? 'null'} · Sumber: {m.source}
                        </small>
                      </div>
                      <span className="tag">{m.qualityStatus.toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'mascot' && (
        <div className="miro-grid">
          <section className="panel miro-card" aria-labelledby="mascot-state-heading">
            <div className="panel-heading">
              <h2 id="mascot-state-heading">
                <Robot weight="duotone" aria-hidden="true" />Maskot 2D dan bukti aturan<small className="miro-code">APP-05 · A05</small>
              </h2>
              <span className="tag">{mascotEval.decision.decision}</span>
            </div>
            <div className="miro-card-body">
              <div className="miro-mascot-showcase" data-mascot-state={mascotEval.mascotState}>
                <MascotAvatar state={mascotEval.mascotState} />
                <div>
                  <span className="tag">{mascotEval.mascotState.toUpperCase()}</span>
                  <h3>{mascotEval.mascotLabel}</h3>
                  <p>{mascotEval.userGuidance}</p>
                  <small>
                    Emosi maskot adalah metafora antarmuka dari aturan deterministik, bukan klaim pengukuran biologis langsung.
                  </small>
                </div>
              </div>
              <label className="miro-field">
                <span>Pertanyaan konteks ke AI (dibatasi pada snapshot unit aktif)</span>
                <input type="text" value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} />
              </label>
              <label className="miro-field">
                <span>Mode pengujian layanan AI (Skenario penerimaan A05)</span>
                <SelectField label="Mode pengujian layanan AI" value={aiMode} onValueChange={value => setAiMode(value as typeof aiMode)} options={[{ value: 'verified', label: 'Normal · AI merangkum bukti aturan' }, { value: 'stale_contradiction', label: 'Uji sensor usang · jawaban optimistis wajib ditolak' }, { value: 'timeout', label: 'Uji timeout · kembali ke aturan' }]} />
              </label>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  try {
                    const testCase: PotCase =
                      aiMode === 'stale_contradiction'
                        ? { ...activePotCase, now_h: activePotCase.now_h + 1 }
                        : activePotCase
                    const res = generateAiSnapshot(eco, {
                      unitId: currentUnit.id,
                      potCase: testCase,
                      userQuestion: aiQuestion,
                      candidateAiResponse:
                        aiMode === 'stale_contradiction'
                          ? 'Tanaman sangat sehat dan optimal, silakan lanjutkan!'
                          : undefined,
                      simulateTimeout: aiMode === 'timeout',
                    })
                    setEco(res.state)
                    notifyOk(
                      res.snapshot.sourceMode === 'rule_fallback'
                        ? 'Fallback aturan diterapkan: output AI yang timeout/kontradiktif ditolak.'
                        : 'Snapshot penjelasan AI berhasil dibuat dan dibekukan terhadap versi profil.'
                    )
                  } catch (err) {
                    notifyErr(err)
                  }
                }}
              >
                Buat AI Snapshot & Evaluasi Maskot
              </button>
            </div>
          </section>

          <section className="panel miro-card" aria-labelledby="ai-history-heading">
            <div className="panel-heading">
              <h2 id="ai-history-heading">Riwayat snapshot AI<small className="miro-code">E02 · AI_SNAPSHOT</small></h2>
              <span className="tag">{eco.aiSnapshots.length} SNAPSHOT</span>
            </div>
            <div className="miro-card-body">
              {eco.aiSnapshots.length === 0 ? (
                <p className="section-hint">
                  Belum ada snapshot. Tekan tombol di samping untuk membekukan bukti sensor, versi profil, dan penjelasan AI.
                </p>
              ) : (
                <ul className="miro-list">
                  {eco.aiSnapshots.slice(0, 4).map(snap => (
                    <li key={snap.id}>
                      <div>
                        <strong>
                          {snap.decisionAndState} · <code>{snap.profileVersionId}</code>
                        </strong>
                        <p>{snap.explanation}</p>
                        <small>
                          Mode: {snap.sourceMode === 'ai_verified' ? 'AI Terverifikasi' : 'Fallback Aturan Deterministik'} ·{' '}
                          {snap.modelPromptVersion}
                        </small>
                      </div>
                      <span className="tag">{snap.sourceMode === 'ai_verified' ? 'AI OK' : 'FALLBACK'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {online && tab === 'energy' && <div className="online-panel"><ProductEnergy {...online} /><ProductRewards {...online} /></div>}
      {tab === 'energy' && (
        <div className="miro-grid">
          <section className="panel miro-card" aria-labelledby="solar-sizing-heading">
            <div className="panel-heading">
              <h2 id="solar-sizing-heading">
                <Sun weight="duotone" aria-hidden="true" />Energi surya dan baterai<small className="miro-code">A10</small>
              </h2>
              <span className="tag">{sizing.powerPolicy.toUpperCase()}</span>
            </div>
            <div className="miro-card-body">
              <p className="section-hint">
                Menghitung kebutuhan harian 24 jam sesuai rumus pada <code>SPESIFIKASI.md</code> Bab 4.
              </p>
              <div className="miro-form-three">
                <label className="miro-field">
                  <span>Daya siaga (W)</span>
                  <input type="number" step="0.05" value={sleepW} onChange={e => setSleepW(Number(e.target.value) || 0)} />
                </label>
                <label className="miro-field">
                  <span>Daya ukur/TX (W)</span>
                  <input type="number" step="0.1" value={activeW} onChange={e => setActiveW(Number(e.target.value) || 0)} />
                </label>
                <label className="miro-field">
                  <span>Durasi aktif (jam/hari)</span>
                  <input
                    type="number"
                    min="0.5"
                    max="23.5"
                    step="0.5"
                    value={activeHours}
                    onChange={e => setActiveHours(Math.min(23.5, Math.max(0.5, Number(e.target.value) || 1)))}
                  />
                </label>
              </div>
              <div className="miro-form-three">
                <label className="miro-field">
                  <span>Hari otonomi</span>
                  <input
                    type="number"
                    min="1"
                    max="14"
                    value={autonomyDays}
                    onChange={e => setAutonomyDays(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <label className="miro-field">
                  <span>Jam matahari puncak (PSH)</span>
                  <input
                    type="number"
                    step="0.2"
                    min="1"
                    value={peakSunHours}
                    onChange={e => setPeakSunHours(Math.max(1, Number(e.target.value) || 4))}
                  />
                </label>
                <label className="miro-field">
                  <span>SOC Baterai Saat Ini (%)</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={socPct}
                    onChange={e => setSocPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                  />
                </label>
              </div>
              <dl className="miro-sizing-results">
                <div>
                  <dt>Beban harian (E_harian)</dt>
                  <dd>{sizing.dailyEnergyWh.toFixed(2)} Wh/hari</dd>
                </div>
                <div>
                  <dt>Min. kapasitas baterai</dt>
                  <dd>
                    {sizing.minBatteryWh.toFixed(1)} Wh ({sizing.minBatteryAh.toFixed(2)} Ah @ 12V)
                  </dd>
                </div>
                <div>
                  <dt>Min. ukuran panel surya</dt>
                  <dd>{sizing.minPanelWp.toFixed(2)} Wp</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="panel miro-card" aria-labelledby="reward-ledger-heading">
            <div className="panel-heading">
              <h2 id="reward-ledger-heading">
                <Medal weight="duotone" aria-hidden="true" />Hadiah, ledger, dan penukaran<small className="miro-code">U04 · E03 · A06</small>
              </h2>
              <span className="tag">{pointSummary.availablePoints} POIN RESMI</span>
            </div>
            <div className="miro-card-body">
              <label className="miro-field">
                <span>Sumber bukti klaim energi & perawatan</span>
                <SelectField label="Sumber bukti klaim hadiah" value={energySourceMode} onValueChange={value => setEnergySourceMode(value as typeof energySourceMode)} options={[{ value: 'verified_meter', label: 'Meter terverifikasi · menambah poin resmi' }, { value: 'simulated', label: 'Data simulasi tanpa meter · hanya saldo demo' }]} />
              </label>
              <div className="miro-actions-row">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    try {
                      const startMs = 1_700_100_000_000 + eco.energyWindows.length * 7_200_000
                      const winRes = recordEnergyWindow(eco, {
                        deviceId: eco.devices[0].id,
                        bootId: 'boot-energy-01',
                        startAtMs: startMs,
                        endAtMs: startMs + 3_600_000,
                        solarHarvestWh: Number(sizing.dailyEnergyWh.toFixed(2)),
                        loadWh: Number((sizing.dailyEnergyWh * 0.6).toFixed(2)),
                        batterySocPct: socPct,
                        evidenceQuality: energySourceMode,
                      })
                      const claimRes = claimGardeningReward(winRes.state, {
                        accountId: activeAccount.id,
                        energyWindowId: winRes.window.id,
                        sourceEventKey: `evt-${winRes.window.id}`,
                        source: energySourceMode === 'verified_meter' ? 'device' : 'simulation',
                        points: 120,
                      })
                      setEco(claimRes.state)
                      notifyOk(
                        claimRes.event.verificationStatus === 'verified'
                          ? `Kredit +120 poin resmi tercatat di ledger. Saldo tersedia: ${claimRes.availablePoints} poin.`
                          : `Data simulasi ditolak untuk kredit nyata (Skenario 6). Ditambahkan ke Saldo Demo (${claimRes.demoPoints} poin).`
                      )
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  Rekam Jendela Energi & Klaim +120 Poin
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    try {
                      const res = compensateLedgerEntry(eco, {
                        operatorAccountId: activeAccount.id,
                        accountId: eco.accounts[0].id,
                        signedPoints: 25,
                        reason: 'Koreksi kompensasi audit operator',
                        idempotencyKey: `comp-${Date.now()}`,
                      })
                      setEco(res.state)
                      notifyOk('Entry kompensasi +25 poin ditambahkan tanpa menghapus ledger lama (RW-04).')
                    } catch (err) {
                      notifyErr(err)
                    }
                  }}
                >
                  Kompensasi Ledger (RW-04)
                </button>
              </div>

              <h3 className="miro-subheading">Katalog penukaran<small className="miro-code">RW-03 · RW-05</small></h3>
              <ul className="miro-list">
                {eco.catalogItems.map(item => {
                  const availableStock = item.stockTotal - item.stockReserved
                  return (
                    <li key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          Biaya: <b>{item.pointCost} poin</b> · Stok tersedia: {availableStock}/{item.stockTotal} (Direservasi:{' '}
                          {item.stockReserved})
                        </small>
                      </div>
                      <button
                        type="button"
                        className="button"
                        disabled={availableStock < 1}
                        onClick={() => {
                          try {
                            const res = requestCatalogRedemption(eco, {
                              accountId: activeAccount.id,
                              catalogItemId: item.id,
                              idempotencyKey: `redeem-${activeAccount.id}-${item.id}-${eco.redemptions.length + 1}`,
                            })
                            setEco(res.state)
                            notifyOk(
                              `Reservasi ${item.title} berhasil (${item.pointCost} poin ditahan). Sisa poin tersedia: ${res.availablePoints}.`
                            )
                          } catch (err) {
                            notifyErr(err)
                          }
                        }}
                      >
                        Tukar ({item.pointCost} Poin)
                      </button>
                    </li>
                  )
                })}
              </ul>

              {eco.redemptions.length > 0 && (
                <>
                  <h3 className="miro-subheading">Pesanan dan reservasi aktif</h3>
                  <ul className="miro-list">
                    {eco.redemptions.map(red => {
                      const item = eco.catalogItems.find(c => c.id === red.catalogItemId)
                      return (
                        <li key={red.id}>
                          <div>
                            <strong>
                              {item?.title ?? red.catalogItemId} ({red.reservedPoints} poin)
                            </strong>
                            <small>
                              Status: <code>{red.status}</code> · Key: <code>{red.idempotencyKey}</code>
                            </small>
                          </div>
                          {red.status === 'reserved' && (
                            <div className="miro-inline-buttons">
                              <button
                                type="button"
                                className="button"
                                onClick={() => {
                                  try {
                                    const res = cancelCatalogRedemption(eco, {
                                      redemptionId: red.id,
                                      accountId: red.accountId,
                                    })
                                    setEco(res.state)
                                    notifyOk('Reservasi dibatalkan; poin dan stok dikembalikan.')
                                  } catch (err) {
                                    notifyErr(err)
                                  }
                                }}
                              >
                                Batal
                              </button>
                              <button
                                type="button"
                                className="button primary"
                                onClick={() => {
                                  try {
                                    const res = fulfillCatalogRedemption(eco, {
                                      redemptionId: red.id,
                                      operatorAccountId: activeAccount.id,
                                    })
                                    setEco(res.state)
                                    notifyOk('Pesanan dipenuhi oleh Operator; debit ledger diselesaikan.')
                                  } catch (err) {
                                    notifyErr(err)
                                  }
                                }}
                              >
                                Penuhi (Operator)
                              </button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {online && tab === 'community' && <div className="online-panel"><ProductKnowledge {...online} /></div>}
      {tab === 'community' && (
        <div className="miro-grid">
          <section className="panel miro-card" aria-labelledby="community-curation-heading">
            <div className="panel-heading">
              <h2 id="community-curation-heading">
                <BookBookmark weight="duotone" aria-hidden="true" />Kontribusi dan kurasi profil<small className="miro-code">U05 · E04 · A07</small>
              </h2>
              <span className="tag">{eco.profileVersions.length} VERSI TERBIT</span>
            </div>
            <div className="miro-card-body">
              <p className="section-hint">
                Kontributor mengajukan profil dengan lisensi dan bukti. Kurator agronomi (harus berbeda dari pengaju) meninjau dan menerbitkan versi profil baru tanpa mengubah riwayat versi lama.
              </p>
              <div className="miro-form-two">
                <label className="miro-field">
                  <span>Lisensi & metode ukur</span>
                  <input type="text" value={contribLicense} onChange={e => setContribLicense(e.target.value)} />
                </label>
                <label className="miro-field">
                  <span>Ambang suhu panas (hot_c °C)</span>
                  <input type="number" step="0.5" value={contribHotC} onChange={e => setContribHotC(e.target.value)} />
                </label>
              </div>
              <label className="miro-field">
                <span>Referensi bukti / dataset</span>
                <input type="text" value={contribEvidence} onChange={e => setContribEvidence(e.target.value)} />
              </label>
              <label className="miro-field">
                <span>Catatan kontribusi (dilindungi filter anti-injeksi & privasi)</span>
                <input type="text" value={contribNotes} onChange={e => setContribNotes(e.target.value)} />
              </label>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  try {
                    const res = submitProfileContribution(eco, {
                      authorAccountId: activeAccount.id,
                      profileId: eco.plantProfiles[0].id,
                      sourceMethodLicense: contribLicense,
                      evidenceRef: contribEvidence,
                      proposedProfile: {
                        ...activePotCase.profile,
                        hot_c: Number(contribHotC) || activePotCase.profile.hot_c,
                      },
                      notes: contribNotes,
                    })
                    setEco(res.state)
                    notifyOk(`Kontribusi ${res.contribution.id} masuk antrean pending_review (KB-02).`)
                  } catch (err) {
                    notifyErr(err)
                  }
                }}
              >
                Ajukan Kontribusi Profil (KB-02)
              </button>

              {eco.contributions.length > 0 && (
                <>
                  <h3 className="miro-subheading">Antrean tinjauan kurator<small className="miro-code">KB-04</small></h3>
                  <label className="miro-field">
                    <span>Catatan keputusan kurator</span>
                    <input type="text" value={reviewReason} onChange={e => setReviewReason(e.target.value)} />
                  </label>
                  <ul className="miro-list">
                    {eco.contributions.map(c => (
                      <li key={c.id}>
                        <div>
                          <strong>
                            {c.id} · hot_c {c.proposedParameters.hot_c} °C (Revisi #{c.revisionCount})
                          </strong>
                          <p>{c.notes}</p>
                          <small>
                            Penulis: <code>{c.authorAccountId}</code> · Status: <code>{c.status}</code>
                          </small>
                        </div>
                        {c.status === 'pending_review' && (
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => {
                              try {
                                const res = reviewProfileContribution(eco, {
                                  contributionId: c.id,
                                  reviewerAccountId: activeAccount.id,
                                  decision: 'approved',
                                  decisionReason: reviewReason,
                                  evidenceLevel: 'curated_field_verified',
                                })
                                setEco(res.state)
                                notifyOk(
                                  `Disetujui oleh Kurator! Versi profil v${res.publishedVersion?.version} resmi diterbitkan.`
                                )
                              } catch (err) {
                                notifyErr(err)
                              }
                            }}
                          >
                            Setujui & Terbitkan (Kurator)
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h3 className="miro-subheading">Versi profil terbit<small className="miro-code">KB-01</small></h3>
              <ul className="miro-list">
                {eco.profileVersions.map(ver => (
                  <li key={ver.id}>
                    <div>
                      <strong>
                        v{ver.version} · {ver.parametersAndScope.crop} ({ver.evidenceLevel})
                      </strong>
                      <small>
                        Media: {ver.parametersAndScope.media} · Ambang panas: {ver.parametersAndScope.hot_c} °C
                      </small>
                    </div>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        onApplyProfileVersion(ver.parametersAndScope, `v${ver.version} (${ver.evidenceLevel})`)
                        notifyOk(`Profil v${ver.version} diterapkan ke simulator.`)
                      }}
                    >
                      Pakai di Simulator <ArrowUpRight />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel miro-card" aria-labelledby="blockchain-outbox-heading">
            <div className="panel-heading">
              <h2 id="blockchain-outbox-heading">
                <LinkSimple weight="duotone" aria-hidden="true" />Outbox dan komitmen blockchain<small className="miro-code">A08</small>
              </h2>
              <span className="tag">BASE SEPOLIA · {eco.outboxJobs.length} JOB</span>
            </div>
            <div className="miro-card-body">
              <p className="section-hint">
                Menyimpan hash komitmen SHA-256 tanpa data pribadi atau kode rahasia. Timeout jaringan tidak membatalkan konsumsi kode di DB.
              </p>
              <ul className="miro-list">
                {eco.outboxJobs.map(job => {
                  const verification = verifyBlockchainCommitment(job, job.artifactBytes)
                  return (
                    <li key={job.id} className="miro-outbox-item">
                      <div>
                        <strong>
                          {job.kind.toUpperCase()} · <code>{job.eventKey}</code>
                        </strong>
                        <small>
                          SHA-256: <code>{job.artifactSha256.slice(0, 24)}…</code> · Percobaan: {job.attempts}
                        </small>
                        {job.txHash && (
                          <small>
                            Tx: <code>{job.txHash.slice(0, 22)}…</code> · Blok #{job.blockNumber} · Verifikasi Digest:{' '}
                            <strong>{verification.verified ? 'COCOK (VALID)' : 'BELUM TERKONFIRMASI'}</strong>
                          </small>
                        )}
                        {job.lastError && <small className="warning-text">{job.lastError}</small>}
                        <pre className="miro-artifact-preview">{job.artifactBytes}</pre>
                      </div>
                      <div className="miro-inline-buttons">
                        <span className="tag">{job.status.toUpperCase()}</span>
                        {job.status !== 'confirmed' && (
                          <>
                            <button
                              type="button"
                              className="button"
                              onClick={() => {
                                const res = processOutboxJob(eco, { jobId: job.id, simulateOutcome: 'timeout' })
                                setEco(res.state)
                                notifyOk(`Job ${job.id} timeout (percobaan #${res.job.attempts}); status tetap pending.`)
                              }}
                            >
                              Uji Timeout
                            </button>
                            <button
                              type="button"
                              className="button primary"
                              onClick={() => {
                                const res = processOutboxJob(eco, { jobId: job.id, simulateOutcome: 'confirm' })
                                setEco(res.state)
                                notifyOk(`Job ${job.id} terkonfirmasi pada blok #${res.job.blockNumber}.`)
                              }}
                            >
                              Konfirmasi Receipt
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
