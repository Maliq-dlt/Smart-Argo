import { createContext, useContext } from 'react'
import type { AccountDeletion, OwnedProduct, ProductAccountClient } from '../lib/productAccountClient'
import type { Identity } from '../lib/identity'

export type { Identity }
export interface AccountState {
  client: ProductAccountClient | null
  ready: boolean
  signedIn: boolean
  /** ensure_my_account has answered for this session. The app opens on `signedIn` alone, but a first sign-in has no
   * account row until then and account calls answer 'unauthorized', which reads as a lost session: call the server only
   * once this is true. */
  loaded: boolean
  identity: Identity | null
  products: OwnedProduct[]
  /** Account roles (owner, contributor, curator, operator): they choose which tools to show; the server checks every call. */
  roles: string[]
  /** Google returned a session that still needs the authenticator code. */
  mfaPending: boolean
  /** Set when the account asked to be deleted and is inside its 14-day grace period: the app shows only the way back. */
  deletion: AccountDeletion | null
  /** The profile photo as a data URL, or the Google photo; null shows initials. */
  avatar: string | null
  setAvatar(avatar: string | null): void
  cancelDeletion(): Promise<string[]>
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
