/* The user's browser wallet over EIP-1193, found through EIP-6963 announcements (several wallets can coexist)
 * with `window.ethereum` as the fallback. The app never sees a private key: the wallet asks the user, signs and
 * broadcasts. Only a zero-value transaction to the user's own address with the proof data is ever requested. */
import { proofCalldata, type ChainNetwork, type Rpc } from './chainProof'

export interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
export interface Wallet { id: string; name: string; provider: Eip1193 }

const isProvider = (value: unknown): value is Eip1193 => !!value && typeof (value as Eip1193).request === 'function'

export function discoverWallets(wait = 350): Promise<Wallet[]> {
  return new Promise(resolve => {
    const found = new Map<string, Wallet>()
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail as { info?: { uuid?: unknown; name?: unknown; rdns?: unknown }; provider?: unknown } | undefined
      const id = String(detail?.info?.rdns || detail?.info?.uuid || '')
      if (!id || !isProvider(detail?.provider) || found.has(id)) return
      found.set(id, { id, name: String(detail?.info?.name || 'Wallet').slice(0, 60), provider: detail.provider })
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', announce)
      const injected = (window as { ethereum?: unknown }).ethereum
      if (!found.size && isProvider(injected)) found.set('injected', { id: 'injected', name: 'Wallet browser', provider: injected })
      resolve([...found.values()])
    }, wait)
  })
}

const hexChain = (id: number) => `0x${id.toString(16)}`
const code = (error: unknown) => (error && typeof error === 'object' && 'code' in error ? Number((error as { code: unknown }).code) : NaN)

/** Asks for one account and moves the wallet onto the test network, adding it if the wallet does not know it. */
export async function connectWallet(wallet: Wallet, network: ChainNetwork): Promise<string> {
  const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' })
  const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0].toLowerCase() : ''
  if (!/^0x[0-9a-f]{40}$/.test(account)) throw new Error('Wallet tidak memberikan alamat akun.')
  const params = [{ chainId: hexChain(network.id) }]
  try { await wallet.provider.request({ method: 'wallet_switchEthereumChain', params }) } catch (error) {
    if (code(error) !== 4902) throw error
    await wallet.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChain(network.id), chainName: network.name, rpcUrls: [network.rpc], blockExplorerUrls: [network.explorer], nativeCurrency: { name: 'Sepolia Ether', symbol: network.currency, decimals: 18 } }] })
    // Some wallets add the network without moving to it.
    await wallet.provider.request({ method: 'wallet_switchEthereumChain', params })
  }
  const chain = await wallet.provider.request({ method: 'eth_chainId' })
  if (typeof chain !== 'string' || Number.parseInt(chain, 16) !== network.id) throw new Error(`Wallet belum berada di ${network.name}. Tidak ada transaksi yang dikirim.`)
  return account
}

/** Requests the zero-value self transfer carrying the record hash; returns the transaction hash. */
export async function sendProofTransaction(wallet: Wallet, account: string, hash: string): Promise<string> {
  const tx = await wallet.provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: account, value: '0x0', data: proofCalldata(hash) }] })
  if (typeof tx !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error('Wallet tidak mengembalikan hash transaksi. Periksa riwayat wallet sebelum mencoba lagi.')
  return tx.toLowerCase()
}

export const walletRpc = (wallet: Wallet): Rpc => (method, params = []) => wallet.provider.request({ method, params })

export function walletMessage(error: unknown) {
  switch (code(error)) {
    case 4001: return 'Permintaan ditolak di wallet. Tidak ada transaksi yang dikirim.'
    case 4100: return 'Wallet belum mengizinkan aplikasi ini. Buka wallet dan sambungkan akun.'
    case -32002: return 'Ada permintaan yang masih menunggu di wallet. Buka wallet untuk menyelesaikannya.'
    case -32000: case -32603: return 'Wallet atau jaringan menolak transaksi (misalnya saldo testnet kurang untuk biaya gas). Tidak diklaim tercatat.'
  }
  return error instanceof Error && error.message ? error.message : 'Wallet gagal memproses permintaan. Tidak diklaim tercatat; periksa wallet sebelum mencoba lagi.'
}
