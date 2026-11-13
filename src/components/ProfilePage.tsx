import { Package, ShieldCheck, SignOut, UserCircle, GoogleLogo, EnvelopeSimple } from '@phosphor-icons/react'
import { useState } from 'react'
import ProductAccount from './ProductAccount'
import ProductSecurity from './ProductSecurity'
import { useAccount } from './accountContext'

const SECTIONS = [['account', 'Akun', UserCircle], ['security', 'Keamanan', ShieldCheck], ['products', 'Produk', Package]] as const
type Section = typeof SECTIONS[number][0]

/** One section at a time (account, security, products), so nothing sits far down the page. */
export default function ProfilePage() {
  const account = useAccount()
  const [section, setSection] = useState<Section>('account')
  if (!account.client) return <section className="panel profile-empty"><h2>Akun belum tersedia</h2><p>Demo ini berjalan tanpa server akun. Simulator tetap bisa dipakai sebagai tamu.</p></section>
  if (!account.signedIn || !account.identity) return <section className="panel profile-empty"><h2>Belum masuk</h2>
    <p>Masuk untuk melihat akun, keamanan, dan produk Anda. Data tamu tetap di browser ini.</p><a className="button primary" href="#masuk">Masuk</a></section>
  const { identity, client } = account
  return <div className="profile-page">
    <nav className="profile-nav" aria-label="Bagian profil">
      {SECTIONS.map(([id, label, Icon]) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon aria-hidden="true" weight={section === id ? 'fill' : 'regular'} />{label}</button>)}
    </nav>
    <div className="profile-body">
      {section === 'account' && <section className="panel profile-account" aria-labelledby="profile-account-heading">
        <h2 id="profile-account-heading">Akun</h2>
        <dl>
          <div><dt>Nama</dt><dd>{identity.name}</dd></div>
          <div><dt>Email</dt><dd>{identity.email}</dd></div>
          <div><dt>Cara masuk</dt><dd>{identity.google ? <><GoogleLogo aria-hidden="true" />Google</> : <><EnvelopeSimple aria-hidden="true" />Email dan kata sandi</>}</dd></div>
        </dl>
        <button type="button" className="button" onClick={() => { void account.signOut(); location.hash = '#masuk' }}><SignOut aria-hidden="true" />Keluar</button>
      </section>}
      {section === 'security' && <div className="panel profile-security"><ProductSecurity client={client} onChanged={() => void account.refresh()} /></div>}
      {section === 'products' && <ProductAccount />}
    </div>
  </div>
}
