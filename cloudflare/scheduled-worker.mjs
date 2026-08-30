export const withSupabaseKeepalive = (worker, keepalive) => ({
  ...worker,
  async scheduled(controller, environment, context) {
    if (typeof worker.scheduled === 'function') {
      await worker.scheduled(controller, environment, context)
    }
    context.waitUntil(keepalive(environment))
  },
})
