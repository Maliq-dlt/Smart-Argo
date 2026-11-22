import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AccountContext, type AccountState, type Identity } from './accountContext'
import { identityFromClaims } from '../lib/identity'
import StepUpDialog from './StepUpDialog'
import NewPasswordDialog from './NewPasswordDialog'
import { ProductAccountClient, productAccountConfigured, oauthReturn, parseDeletion, parseOwnedProducts, tokenClaims, type AccountDeletion, type OwnedProduct } from '../lib/productAccountClient'
import { avatarSrc, googlePhoto, parseAvatar } from '../lib/avatar'

// A Google return is single-use (code and verifier), so it is handled once per page load. StrictMode's second
// effect run gets the same promise for the same client; a later remount (new client) just restores the session.
let handoff: { client: ProductAccountClient; result: Promise<'ok' | 'mfa' | null> } | null = null
function googleHandoff(client: ProductAccountClient) {
  handoff ??= { client, result: (async () => {
    // Auth reports a failed link (expired, already used) in the fragment: #error=…&error_description=…
    const fragmentError = location.hash.includes('error=') ? oauthReturn(location.hash.slice(1)) : null
    const back = oauthReturn(location.search) ?? oauthReturn(location.hash.split('?')[1] ?? '') ?? fragmentError
    if (!back) return null
    history.replaceState(null, '', location.pathname + (fragmentError ? '#masuk' : location.hash.split('?')[0]))
    if ('error' in back) throw new Error(fragmentError ? `Tautan email tidak berlaku: ${back.error}` : `Masuk dengan Google tidak selesai: ${back.error}`)
    return client.completeReturn(back.code)
  })() }
  return handoff.client === client ? handoff.result : Promise.resolve(null)
}

/** Roles from ensure_my_account; they only choose which tools to show, the server checks every privileged call. */
const rolesOf = (value: Record<string, unknown>) => {
  const roles = (value.account as { access_roles?: unknown } | undefined)?.access_roles
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : []
}

function identityOf(client: ProductAccountClient | null): Identity | null {
  return client?.session ? identityFromClaims(tokenClaims(client.session.access_token)) : null
}

export default function AccountProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => productAccountConfigured ? new ProductAccountClient() : null)
  // Whether Google sign-in is on is one small request: ask now, so the gate is usually drawn in its final shape.
  useEffect(() => { client?.googleEnabled().catch(() => undefined) }, [client])
  const [ready, setReady] = useState(!client)
  const [signedIn, setSignedIn] = useState(false)
  const [products, setProducts] = useState<OwnedProduct[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [mfaPending, setMfaPending] = useState(false)
  const [notice, setNotice] = useState<AccountState['notice']>(null)
  const [version, setVersion] = useState(0)
  const [deletion, setDeletion] = useState<AccountDeletion | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  // Privileged writes ask for a fresh authenticator code through this dialog (ProductAccountClient.rpc).
  const [stepUp, setStepUp] = useState<{ resolve: (code: string | null) => void } | null>(null)
  useEffect(() => {
    if (!client) return
    client.stepUp = () => new Promise(resolve => setStepUp({ resolve }))
    return () => { client.stepUp = null }
  }, [client])

  /** Asked first after every sign-in: an account waiting to be deleted answers 'unauthorized' everywhere else, which
   * would otherwise read as an expired session and drop the person back at the gate with no way to cancel. */
  const load = useCallback(async (c: ProductAccountClient) => {
    // A backend without the deletion migration (404) has nothing pending; only a session verdict stops the sign-in.
    const waiting = parseDeletion((await c.rpc('my_account_deletion').catch(err => {
      if (['unauthorized', 'invalid_session'].includes((err as { code?: string }).code ?? '')) throw err
      return { deletion: null }
    })).deletion)
    if (waiting) return { waiting, roles: [] as string[], owned: [] as OwnedProduct[], photo: null }
    const found = rolesOf(await c.rpc('ensure_my_account'))
    const owned = parseOwnedProducts((await c.rpc('my_products')).products)
    const stored = parseAvatar((await c.rpc('my_avatar').catch(() => ({ avatar: null }))).avatar)
    return { waiting: null, roles: found, owned, photo: avatarSrc(stored) ?? googlePhoto(tokenClaims(c.session?.access_token)) }
  }, [])
  const refresh = useCallback(async () => {
    if (client?.session) {
      const next = await load(client)
      setDeletion(next.waiting); setRoles(next.roles); setProducts(next.owned); setAvatar(next.photo)
    } else { setProducts([]); setRoles([]); setDeletion(null); setAvatar(null) }
    setMfaPending(false)
    setSignedIn(Boolean(client?.session)); setVersion(v => v + 1)
  }, [client, load])
  const cancelDeletion = useCallback(async () => {
    if (!client) return []
    const value = await client.rpc('cancel_account_deletion')
    await refresh()
    return Array.isArray(value.restored) ? value.restored.filter((s): s is string => typeof s === 'string') : []
  }, [client, refresh])
  const expire = useCallback((text = 'Sesi berakhir. Masuk kembali.') => {
    setProducts([]); setRoles([]); setDeletion(null); setAvatar(null); setSignedIn(false); setNotice({ error: true, text })
  }, [])
  const signOut = useCallback(async () => {
    setProducts([]); setRoles([]); setDeletion(null); setAvatar(null); setSignedIn(false)
    try { await client?.logout(); setNotice({ error: false, text: 'Berhasil keluar.' }) }
    catch { setNotice({ error: true, text: 'Sesi pada browser sudah dihapus. Keluar dari layanan gagal; periksa koneksi sebelum masuk kembali.' }) }
  }, [client])

  useEffect(() => {
    if (!client) return
    let active = true
    googleHandoff(client).then(async viaGoogle => {
      if (viaGoogle === 'mfa') { if (active) setMfaPending(true); return }
      if (!client.session) await client.restore()
      // The app opens as soon as the stored session is read; products follow in the background.
      if (active) { setReady(true); setSignedIn(Boolean(client.session)) }
      if (client.session) {
        const next = await load(client)
        if (active) {
          setDeletion(next.waiting); setProducts(next.owned); setRoles(next.roles); setAvatar(next.photo)
          if (viaGoogle === 'ok' && !next.waiting) setNotice({ error: false, text: 'Berhasil masuk dengan Google.' })
        }
      }
    }).catch(err => {
      if (!active) return
      if (!client.session) setSignedIn(false)
      setNotice({ error: true, text: err instanceof Error ? err.message : 'Sesi gagal dipulihkan.' })
    }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [client, load])

  useEffect(() => {
    if (!client || !signedIn) return
    let active = true
    const timer = window.setInterval(() => {
      client.refreshIfNeeded().catch(err => { if (active) expire(err instanceof Error ? err.message : undefined) })
    }, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [client, signedIn, expire])

  const value = useMemo<AccountState>(() => ({
    client, ready, signedIn, identity: signedIn ? identityOf(client) : null, products, roles, mfaPending, deletion, avatar, setAvatar, cancelDeletion,
    notice, setNotice, refresh, signOut, expire,
  // `version` re-derives the identity and re-renders readers after aal or token changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [client, ready, signedIn, products, roles, mfaPending, deletion, avatar, cancelDeletion, notice, refresh, signOut, expire, version])
  return <AccountContext.Provider value={value}>{children}{stepUp && <StepUpDialog onDone={code => { stepUp.resolve(code); setStepUp(null) }} />}
    {signedIn && client?.resetting && <NewPasswordDialog onClose={() => { client.resetting = false; setVersion(v => v + 1) }}
      onSave={async password => { await client.setPassword(password); setNotice({ error: false, text: 'Kata sandi baru tersimpan.' }); setVersion(v => v + 1) }} />}</AccountContext.Provider>
}
