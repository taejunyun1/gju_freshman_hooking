import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  deriveInitialPassword,
  derivePasswordDigest,
  findNextPasswordGeneration,
} from '../../../server/modules/identity/roster-credentials'
import { hmacSha256, utf8 } from '../../../server/utils/web-crypto'

const cycleId = '8d60bf06-4160-4ea3-a1ed-6a4976c274b4'
const pepper = new Uint8Array(32).fill(29)

describe('roster credential primitives', () => {
  it('derives the password digest with the exact verification domain', async () => {
    const digest = await derivePasswordDigest('4225AB', pepper)
    const expected = await hmacSha256(utf8('password-verify-v1\0' + '4225AB'), pepper)

    expect(digest).toEqual(expected)
    expect(digest).toHaveLength(32)
  })

  it('deterministically issues a six-character password from cycle, phone, and generation', async () => {
    const issued = await deriveInitialPassword({ cycleId, phone: '01012344225', generation: 1, pepper })

    expect(issued).toBe('4225DE')
    expect(issued).toMatch(/^4225[A-Z]{2}$/u)
    await expect(deriveInitialPassword({ cycleId, phone: '010-1234-4225', generation: 1, pepper }))
      .resolves.toBe(issued)
  })

  it('finds a later generation whose password differs from the current one', async () => {
    const issued = await deriveInitialPassword({ cycleId, phone: '01012344225', generation: 1, pepper })
    const next = await findNextPasswordGeneration({
      cycleId,
      phone: '01012344225',
      currentGeneration: 1,
      pepper,
    })

    expect(next.password).not.toBe(issued)
    expect(next.generation).toBeGreaterThan(1)
    expect(next.generation).toBeLessThanOrEqual(33)
  })

  it('fails closed before the 32-generation search would exceed int32', async () => {
    await expect(findNextPasswordGeneration({
      cycleId,
      phone: '01012344225',
      currentGeneration: 2_147_483_616,
      pepper,
    })).rejects.toThrowError('PASSWORD_GENERATION_EXHAUSTED')
  })

  it('rejects password peppers that are not exactly 32 bytes', async () => {
    await expect(derivePasswordDigest('4225AB', new Uint8Array(31)))
      .rejects.toThrowError('CRYPTO_SECRET_INVALID')
    await expect(deriveInitialPassword({
      cycleId,
      phone: '01012344225',
      generation: 1,
      pepper: new Uint8Array(33),
    })).rejects.toThrowError('CRYPTO_SECRET_INVALID')
  })

  it('does not introduce PBKDF2 into roster credential derivation', () => {
    const source = readFileSync('server/modules/identity/roster-credentials.ts', 'utf8')

    expect(source).not.toMatch(/PBKDF2/iu)
  })
})
