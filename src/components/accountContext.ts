import { createContext, useContext } from 'react'
import type { OwnedProduct, PotSetup, ProductAccountClient } from '../lib/productAccountClient'

/** `pot` is null until the person has set up their first pot (asked once after sign-up). */
export interface Identity { name: string; email: string; google: boolean; pot: PotSetup | null }
export interface AccountState {
  client: ProductAccountClient | null
  ready: boolean
  signedIn: boolean
  identity: Identity | null
  products: OwnedProduct[]
  /** Account roles (owner, contributor, curator, operator): they choose which tools to show; the server checks every call. */
  roles: string[]
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
