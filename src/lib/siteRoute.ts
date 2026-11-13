export const isSimulatorHash = (hash: string) => ['#statistik', '#simulasi', '#bandingkan', '#perangkat', '#terminal', '#ekosistem', '#masuk', '#profil'].includes(hash)

export interface EntryState { configured: boolean; ready: boolean; signedIn: boolean; guest: boolean; hash: string }
/** Mode A: the gate offers Google, email or guest. Without a backend there is nothing to sign in to.
 * Mode B (`signInRequired`, hosted build): the caller passes `guest: false` and the gate hides the guest button. */
export function entryView({ configured, ready, signedIn, guest, hash }: EntryState): 'loading' | 'gate' | 'app' {
  if (!configured) return 'app'
  // A guest needs no session check to enter; the account menu updates once the stored session is read.
  if (guest && hash !== '#masuk') return 'app'
  if (!ready) return 'loading'
  return signedIn ? 'app' : 'gate'
}
