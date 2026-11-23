import { createAlertDispatchHandler } from './handler.ts'
import { observeHandler } from '../_shared/observability.ts'
declare const Deno: { env:{get(key:string):string|undefined}; serve(handler:(request:Request)=>Promise<Response>):void }
const env=(key:string)=>Deno.env.get(key)
Deno.serve(observeHandler('alert-dispatch',createAlertDispatchHandler({url:env('SUPABASE_URL')!,serviceKey:env('SUPABASE_SERVICE_ROLE_KEY')!,env})))
