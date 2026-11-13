/** Vite returns the hashed public URL of a file imported with `?url` (used for the self-hosted QR reader WASM). */
declare module '*?url' {
  const url: string
  export default url
}
