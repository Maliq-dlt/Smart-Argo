function bytes(value: string, length: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid encoding')
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  if (result.length !== length || btoa(String.fromCharCode(...result)) !== value) throw new Error('Invalid length')
  return result
}
export async function verifyDeviceSignature(publicKey: string, signature: string, message: string): Promise<boolean> {
  try {
    if (publicKey.length !== 44 || signature.length !== 88) return false
    const key = await crypto.subtle.importKey('raw', bytes(publicKey, 32), 'Ed25519', false, ['verify'])
    return await crypto.subtle.verify('Ed25519', key, bytes(signature, 64), new TextEncoder().encode(message))
  } catch { return false }
}
