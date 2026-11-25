import { useState } from 'react'
import { useAccount } from './accountContext'
import ProductAccount from './ProductAccount'
import ProductUnits from './ProductUnits'
import ProductTelemetry from './ProductTelemetry'
import ProductRewards from './ProductRewards'
import ProductEnergy from './ProductEnergy'
import ProductRewardCases from './ProductRewardCases'
import ProductKnowledge from './ProductKnowledge'

const tabs = ['Produk & QR', 'Unit & sensor', 'Energi & penukaran', 'Komunitas'] as const

export default function LiveEcosystem() {
  const account = useAccount()
  const [tab, setTab] = useState<typeof tabs[number]>(tabs[0])
  const [version, setVersion] = useState(0)
  if (!account.client || !account.signedIn) return <p role="status">Masuk untuk mengelola produk Anda.</p>
  const online = { client: account.client, onSessionExpired: account.expire }
  const units = { version, onUnitsChanged: () => setVersion(v => v + 1) }
  return <div className="miro-workspace">
    <nav className="miro-tabs" aria-label="Modul produk">
      {tabs.map(label => <button key={label} type="button" aria-pressed={tab === label} className={tab === label ? 'is-active' : undefined} onClick={() => setTab(label)}>{label}</button>)}
    </nav>
    <div className="online-panel">
      {tab === 'Produk & QR' && <ProductAccount />}
      {tab === 'Unit & sensor' && <><ProductUnits {...online} {...units} /><ProductTelemetry {...online} {...units} products={account.products} /></>}
      {tab === 'Energi & penukaran' && <><ProductRewards {...online} /><ProductEnergy {...online} /><ProductRewardCases {...online} /></>}
      {tab === 'Komunitas' && <ProductKnowledge {...online} />}
    </div>
  </div>
}
