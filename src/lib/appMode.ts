/** The app runs in one of two modes. `demo` is the prototype as presented: a guest can try it, the simulator room (Ruang tanam)
 * is there to play with, the sky can be chosen and a demo garden can be loaded. `live` is the app a real user signs in to: none
 * of that is shown, because every one of them is a stand-in for something real. It is chosen when the app is built
 * (`npm run build:live`), never at run time, so a demo page cannot be turned into a live one by a visitor. Anything but the exact
 * word `live` is the demo, the behaviour the project has always had. */
export type AppMode = 'demo' | 'live'
export interface Features {
  /** "Coba tanpa akun" at the gate. */
  guest: boolean
  /** Ruang tanam, the room where time and care are played with. */
  playground: boolean
  /** The "Cuaca simulasi" control. */
  simulatedWeather: boolean
  /** "Muat contoh kebun". */
  demoGarden: boolean
}

export const parseAppMode = (raw: unknown): AppMode => raw === 'live' ? 'live' : 'demo'
export const featuresOf = (mode: AppMode): Features => mode === 'live'
  ? { guest: false, playground: false, simulatedWeather: false, demoGarden: false }
  : { guest: true, playground: true, simulatedWeather: true, demoGarden: true }

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
export const appMode: AppMode = parseAppMode(env?.VITE_APP_MODE)
export const features: Features = featuresOf(appMode)
