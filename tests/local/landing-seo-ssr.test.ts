import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { beforeAll, describe, expect, it } from 'vitest'
import { PUBLIC_SEO } from '../../shared/content/public-seo'

type RunningWorker = {
  worker: ChildProcess
  origin: string
}

const readReadyOrigin = (output: string): string | undefined => {
  return output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/u)?.[1]
}

const startWorker = async ({ port = 0 }: { port?: number } = {}): Promise<RunningWorker> => {
  const worker = spawn('corepack', [
    'pnpm', 'exec', 'wrangler', 'dev', '.output/server/index.mjs',
    '--assets', '.output/public', '--local', '--ip', '127.0.0.1', '--port', String(port),
  ], {
    env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let settled = false
  let timeout: NodeJS.Timeout | undefined

  const origin = await new Promise<string>((resolve, reject) => {
    const complete = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      callback()
    }
    const fail = (reason: string) => complete(() => {
      reject(new Error(`The local Worker failed before it became ready: ${reason}\n${output.trim()}`))
    })
    const readOutput = (chunk: Buffer | string) => {
      output += chunk.toString()
      const readyOrigin = readReadyOrigin(output)
      if (readyOrigin !== undefined) complete(() => resolve(readyOrigin))
    }

    worker.stdout?.on('data', readOutput)
    worker.stderr?.on('data', readOutput)
    worker.once('error', error => fail(error.message))
    worker.once('exit', (code, signal) => fail(`exit code ${code ?? 'unknown'}, signal ${signal ?? 'none'}`))
    timeout = setTimeout(() => fail('ready signal was not emitted within 30 seconds'), 30_000)
  }).catch(async (error: unknown) => {
    await stopWorker(worker)
    throw error
  })

  return { worker, origin }
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
  beforeAll(() => {
    const build = spawnSync('corepack', ['pnpm', 'build'], {
      encoding: 'utf8',
      env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
    })

    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
  }, 120_000)

  it('does not mistake a stale listener for a newly started Worker', async () => {
    const staleListener = createServer((_request, response) => {
      response.writeHead(200).end('stale listener')
    })
    await new Promise<void>((resolve, reject) => {
      staleListener.once('error', reject)
      staleListener.listen(0, '127.0.0.1', resolve)
    })
    const address = staleListener.address() as AddressInfo

    try {
      await expect(startWorker({ port: address.port })).rejects.toThrow(
        /failed before it became ready/u,
      )
    }
    finally {
      await new Promise<void>((resolve, reject) => staleListener.close(error => error ? reject(error) : resolve()))
    }
  })

  it('renders the approved landing title and description without leaking it to /login', async () => {
    const running = await startWorker()

    try {
      const landingHtml = await (await fetch(running.origin)).text()
      const loginHtml = await (await fetch(`${running.origin}/login`)).text()

      expect(landingHtml).toContain(`<title>${PUBLIC_SEO.title}</title>`)
      expect(landingHtml).toContain(`<meta name="description" content="${PUBLIC_SEO.description}">`)
      expect(loginHtml).not.toContain(PUBLIC_SEO.title)
      expect(loginHtml).not.toContain(PUBLIC_SEO.description)
    }
    finally {
      await stopWorker(running.worker)
    }
  }, 120_000)
})
