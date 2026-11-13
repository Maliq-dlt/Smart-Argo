import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AccountContext, type AccountState, type Identity } from './accountContext'
import { ProductAccountClient, productAccountConfigured, oauthReturn, parseOwnedProducts, tokenClaims, type OwnedProduct } from '../lib/productAccountClient'

// A Google return is single-use (code and verifier), so it is handled once per page load. StrictMode's second
// effect run gets the same promise for the same client; a later remount (new client) just restores the session.
let handoff: { client: ProductAccountClient; result: Promise<'ok' | 'mfa' | null> } | null = null
function googleHandoff(client: ProductAccountClient) {
  handoff ??= { client, result: (async () => {
    const back = oauthReturn(location.search) ?? oauthReturn(location.hash.split('?')[1] ?? '')
    if (!back) return null
    history.replaceState(null, '', location.pathname + location.hash.split('?')[0])
    if ('error' in back) throw new Error(`Masuk dengan Google tidak selesai: ${back.error}`)
    return client.completeGoogle(back.code)
  })() }
  return handoff.client === client ? handoff.result : Promise.resolve(null)
}

function identityOf(client: ProductAccountClient | null): Identity | null {
  if (!client?.session) return null
  const claims = tokenClaims(client.session.access_token)
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>
  const app = (claims.app_metadata ?? {}) as Record<string, unknown>
  const email = typeof claims.email === 'string' ? claims.email : ''
  const named = [meta.full_name, meta.name].find(v => typeof v === 'string' && v.trim()) as string | undefined
  return { email, name: (named ?? email.split('@')[0]) || 'Akun', google: Array.isArray(app.providers) && app.providers.includes('google') }
}

export default function AccountProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => productAccountConfigured ? new ProductAccountClient() : null)
  const [ready, setReady] = useState(!client)
  const [signedIn, setSignedIn] = useState(false)
  const [products, setProducts] = useState<OwnedProduct[]>([])
  const [mfaPending, setMfaPending] = useState(false)
  const [notice, setNotice] = useState<AccountState['notice']>(null)
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => {
    if (client?.session) {
      await client.rpc('ensure_my_account')
      setProducts(parseOwnedProducts((await client.rpc('my_products')).products))
    } else setProducts([])
    setMfaPending(false)
    setSignedIn(Boolean(client?.session)); setVersion(v => v + 1)
  }, [client])
  const expire = useCallback((text = 'Sesi berakhir. Masuk kembali.') => {
    setProducts([]); setSignedIn(false); setNotice({ error: true, text })
  }, [])
  const signOut = useCallback(async () => {
    setProducts([]); setSignedIn(false)
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
        await client.rpc('ensure_my_account')
        const owned = parseOwnedProducts((await client.rpc('my_products')).products)
        if (active) { setProducts(owned); if (viaGoogle === 'ok') setNotice({ error: false, text: 'Berhasil masuk dengan Google.' }) }
      }
    }).catch(err => {
      if (!active) return
      if (!client.session) setSignedIn(false)
      setNotice({ error: true, text: err instanceof Error ? err.message : 'Sesi gagal dipulihkan.' })
    }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [client])

  useEffect(() => {
    if (!client || !signedIn) return
    let active = true
    const timer = window.setInterval(() => {
      client.refreshIfNeeded().catch(err => { if (active) expire(err instanceof Error ? err.message : undefined) })
    }, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [client, signedIn, expire])

  const value = useMemo<AccountState>(() => ({
    client, ready, signedIn, identity: signedIn ? identityOf(client) : null, products, mfaPending, notice, setNotice, refresh, signOut, expire,
  // `version` re-derives the identity and re-renders readers after aal or token changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [client, ready, signedIn, products, mfaPending, notice, refresh, signOut, expire, version])
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
