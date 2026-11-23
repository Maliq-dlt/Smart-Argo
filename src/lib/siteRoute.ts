export const isSimulatorHash = (hash: string) => ['#statistik', '#tanaman', '#simulasi', '#bandingkan', '#perangkat', '#terminal', '#ekosistem', '#masuk', '#profil', '#hapus-akun'].includes(hash)

export interface EntryState {
  configured: boolean; ready: boolean; signedIn: boolean; guest: boolean; hash: string
  /** A sign-in (Google or email) that still waits for its authenticator code. */
  mfaPending?: boolean
  /** The page opened on a Google or email-link return that is still being completed. */
  returning?: boolean
}
/** The gate offers Google, email or guest. Without a backend there is nothing to sign in to. With `signInRequired`
 * the caller passes `guest: false` and the gate hides the guest button. */
export function entryView({ configured, ready, signedIn, guest, hash, mfaPending = false, returning = false }: EntryState): 'loading' | 'gate' | 'app' {
  if (!configured) return 'app'
  // The authenticator step belongs to the gate, also for someone who had been browsing as a guest: skipping to the
  // app would leave the sign-in half done (the backend still refuses until the code is given).
  if (mfaPending) return 'gate'
  // A guest needs no session check to enter; the account menu updates once the stored session is read. A sign-in
  // return waits for its outcome first, so the guest app does not flash before the gate or the account opens.
  if (guest && hash !== '#masuk' && !(returning && !ready)) return 'app'
  if (!ready) return 'loading'
  return signedIn ? 'app' : 'gate'
}
