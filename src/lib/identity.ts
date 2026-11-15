import { parsePot, type PotSetup } from './productAccountClient.ts'
import { normalizeDisplayName } from './signupForm.ts'

export interface Identity { name: string; email: string; google: boolean; pot: PotSetup | null }

/** Who the token says the person is. Metadata is written by its owner, so every field is validated: the name they
 * chose first, then the provider's name, then the front of the email. */
export function identityFromClaims(claims: Record<string, unknown>): Identity {
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>
  const app = (claims.app_metadata ?? {}) as Record<string, unknown>
  const email = typeof claims.email === 'string' ? claims.email : ''
  const named = [meta.display_name, meta.full_name, meta.name].map(normalizeDisplayName).find(Boolean)
  return { email, name: (named ?? email.split('@')[0]) || 'Akun', google: Array.isArray(app.providers) && app.providers.includes('google'), pot: parsePot(meta.pot) }
}
