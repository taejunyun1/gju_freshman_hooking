import nitroWorker from '../.output/server/index.mjs'
import { createBodyGuardWorker } from './request-body-guard.mjs'
import { withSupabaseKeepalive } from './scheduled-worker.mjs'
import { createSupabaseKeepalive } from './supabase-keepalive.mjs'

export default withSupabaseKeepalive(
  createBodyGuardWorker(nitroWorker),
  createSupabaseKeepalive(),
)
