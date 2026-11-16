import { observeHandler } from '../_shared/observability.ts'
import { createWeatherForecastHandler, signedInVia } from './handler.ts'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void }
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}`); return value }
Deno.serve(observeHandler('weather-forecast', createWeatherForecastHandler({ appOrigin: required('APP_ORIGIN'),
  signedIn: signedInVia(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY')) })))
