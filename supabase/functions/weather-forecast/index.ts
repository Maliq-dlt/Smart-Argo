// Dormant: not in supabase/config.toml, in no deploy script and not in the local gateway. See docs/cuaca.md before activating it.
import { observeHandler } from '../_shared/observability.ts'
import { createWeatherForecastHandler } from './handler.ts'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void }
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}`); return value }
Deno.serve(observeHandler('weather-forecast', createWeatherForecastHandler({ appOrigin: required('APP_ORIGIN') })))
