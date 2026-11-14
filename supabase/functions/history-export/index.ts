import { observeHandler } from '../_shared/observability.ts'
import { createHistoryExportHandler } from './handler.ts'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void }
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}`); return value }
Deno.serve(observeHandler('history-export', createHistoryExportHandler({ url: required('SUPABASE_URL'), serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'), appOrigin: required('APP_ORIGIN') })))
