import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const fixedArguments = ['deploy', '--env', 'staging', '--dry-run']

export const runPreviewDeploy = (callerArguments, runner = spawnSync) => {
  if (callerArguments.length > 0) {
    console.error('Preview deploy does not accept arguments.')
    return 1
  }

  const result = runner('wrangler', fixedArguments, { stdio: 'inherit' })
  if (result.error) {
    console.error('Preview deploy could not start the local CLI.')
    return 1
  }
  return result.status ?? 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = runPreviewDeploy(process.argv.slice(2))
}
