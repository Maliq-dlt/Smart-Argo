import { SignIn, SignOut, UserCircle } from '@phosphor-icons/react'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover'
import { useAccount } from './accountContext'

const initialsOf = (name: string) => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()

/** Who is using the app, and the way out. Guests get the way in; a demo without a backend says why there is none. */
export default function AccountMenu() {
  const { client, signedIn, identity, signOut } = useAccount()
  const name = identity?.name ?? 'Tamu'
  const badge = identity ? <span className="account-initials" aria-hidden="true">{initialsOf(name)}</span> : <UserCircle className="account-guest" aria-hidden="true" />
  return <Popover>
    <PopoverTrigger asChild><button type="button" className="account-trigger" aria-label={`Akun: ${name}`} title={name}>{badge}</button></PopoverTrigger>
    <PopoverContent className="account-menu" align="end" aria-label="Menu akun">
      <div className="account-menu-head">{badge}<div><strong>{name}</strong>
        <small>{identity?.email || (client ? 'Data hanya tersimpan di browser ini' : 'Akun belum tersedia di demo ini')}</small></div></div>
      {signedIn ? <>
        <PopoverClose asChild><a className="menu-item" href="#profil"><UserCircle aria-hidden="true" />Profil & keamanan</a></PopoverClose>
        <PopoverClose asChild><button type="button" className="menu-item" onClick={() => { void signOut(); location.hash = '#masuk' }}><SignOut aria-hidden="true" />Keluar</button></PopoverClose>
      </> : client && <PopoverClose asChild><a className="menu-item" href="#masuk"><SignIn aria-hidden="true" />Masuk</a></PopoverClose>}
    </PopoverContent>
  </Popover>
}
