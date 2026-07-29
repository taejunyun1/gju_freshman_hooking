import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { PUBLIC_SEO } from '../../shared/content/public-seo'

const port = 8796
const origin = `http://127.0.0.1:${port}`

const waitForWorker = async (): Promise<void> => {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    }
    catch {
      // The local Worker can accept requests only after its bundle has loaded.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error('The local Worker did not become ready within 30 seconds.')
}

const stopWorker = async (worker: ChildProcess): Promise<void> => {
  if (worker.exitCode !== null) return

  worker.kill('SIGTERM')
  await Promise.race([
    once(worker, 'exit').then(() => undefined),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ])
}

describe('landing SEO SSR document', () => {
  it('renders the approved landing title and description without leaking it to /login', async () => {
    const build = spawnSync('corepack', ['pnpm', 'build'], {
      encoding: 'utf8',
      env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
    })

    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)

    const worker = spawn('corepack', [
      'pnpm', 'exec', 'wrangler', 'dev', '.output/server/index.mjs',
      '--assets', '.output/public', '--local', '--ip', '127.0.0.1', '--port', String(port),
    ], {
      env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
      stdio: 'ignore',
    })

    try {
      await waitForWorker()

      const landingHtml = await (await fetch(origin)).text()
      const loginHtml = await (await fetch(`${origin}/login`)).text()

      expect(landingHtml).toContain(`<title>${PUBLIC_SEO.title}</title>`)
      expect(landingHtml).toContain(`<meta name="description" content="${PUBLIC_SEO.description}">`)
      expect(loginHtml).not.toContain(PUBLIC_SEO.title)
      expect(loginHtml).not.toContain(PUBLIC_SEO.description)
    }
    finally {
      await stopWorker(worker)
    }
  }, 120_000)
})
