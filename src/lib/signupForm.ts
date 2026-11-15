/* Pure checks for the sign-up form and the email code step, kept out of the components so they can be tested alone. */

export const DISPLAY_NAME_MAX = 40
// Control characters and the bidi overrides/isolates that can make a name read as something else.
const UNSAFE_NAME = /[\p{Cc}‪-‮⁦-⁩]/u

/** The name as it will be stored: trimmed, inner whitespace folded to one space; null unless 1–40 characters (code points). */
export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4 * DISPLAY_NAME_MAX * 2) return null
  const name = raw.trim().replace(/\s+/g, ' ')
  const length = [...name].length
  return length >= 1 && length <= DISPLAY_NAME_MAX && !UNSAFE_NAME.test(name) ? name : null
}

/** Digits only, at most six: "482 915", "482-915" and a pasted "482915\n" all give "482915". */
export const normalizeEmailCode = (raw: string) => raw.replace(/\D/g, '').slice(0, 6)

export type SignupCheck = { ok: true; name: string } | { ok: false; field: 'name' | 'confirm'; message: string }

/** Name first, then the confirmation, which must equal the password exactly (a trailing space is a difference). */
export function checkSignup({ name, password, confirm }: { name: string; password: string; confirm: string }): SignupCheck {
  const clean = normalizeDisplayName(name)
  if (!clean) return { ok: false, field: 'name', message: `Isi nama Anda, 1–${DISPLAY_NAME_MAX} karakter.` }
  if (confirm !== password) return { ok: false, field: 'confirm', message: 'Konfirmasi kata sandi belum sama.' }
  return { ok: true, name: clean }
}
