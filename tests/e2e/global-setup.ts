import { execFileSync } from 'node:child_process'

export default function resetLocalDatabase(): void {
  try {
    execFileSync('pnpm', ['exec', 'supabase', 'db', 'reset', '--local'], {
      stdio: 'ignore',
    })
  }
  catch {
    throw new Error('The local Supabase database reset failed.')
  }
}
