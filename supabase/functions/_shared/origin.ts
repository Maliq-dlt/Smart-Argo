/** APP_ORIGIN may name several browser origins, comma-separated (the public demo and the live app). */
export const appOrigins = (value: string): string[] => value.split(',').map(part => new URL(part.trim()).origin)

/** The origin a response names: the caller's when it is allowed, otherwise the first one (that caller is refused with 403). */
export function originFor(allowed: readonly string[], request: Request): string {
  const asked = request.headers.get('origin')
  return asked && allowed.includes(asked) ? asked : allowed[0]
}
