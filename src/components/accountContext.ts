import { createContext, useContext } from 'react'
import type { OwnedProduct, ProductAccountClient } from '../lib/productAccountClient'

export interface Identity { name: string; email: string; google: boolean }
export interface AccountState {
  client: ProductAccountClient | null
  ready: boolean
  signedIn: boolean
  identity: Identity | null
  products: OwnedProduct[]
  /** Google returned a session that still needs the authenticator code. */
  mfaPending: boolean
  notice: { error: boolean; text: string } | null
  setNotice(notice: AccountState['notice']): void
  /** Reload account and products after any sign-in, and re-render readers of the session (aal changes). */
  refresh(): Promise<void>
  signOut(): Promise<void>
  /** The server refused the session: forget the account locally and go back to the gate. */
  expire(text?: string): void
}

export const AccountContext = createContext<AccountState | null>(null)
export function useAccount() {
  const value = useContext(AccountContext)
  if (!value) throw new Error('useAccount needs AccountProvider')
  return value
}
