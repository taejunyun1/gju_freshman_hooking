const runtimeVersion = process.env.GIT_COMMIT_SHA ?? 'development'

export default defineEventHandler(() => ({
  ok: true,
  commit: runtimeVersion,
}))
