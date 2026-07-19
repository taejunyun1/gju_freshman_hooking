import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  deriveInitialPassword,
  derivePasswordDigest,
  nextPasswordGeneration,
} from '../../../server/modules/identity/roster-credentials'
import { hmacSha256, utf8 } from '../../../server/utils/web-crypto'
import { rosterPasswordSchema } from '../../../shared/schemas/identity'

const pepper = new Uint8Array(32).fill(29)

describe('roster credential primitives', () => {
  it('derives the password digest with the exact verification domain', async () => {
    const digest = await derivePasswordDigest('4225AB', pepper)
    const expected = await hmacSha256(utf8('password-verify-v1\0' + '4225AB'), pepper)

    expect(digest).toEqual(expected)
    expect(digest).toHaveLength(32)
  })

  it('issues a predictable six-digit initial PIN from admission year and normalized phone', async () => {
    const issued = await deriveInitialPassword({ admissionYear: 2026, phone: '01012344225' })

    expect(issued).toBe('264225')
    expect(issued).toMatch(/^\d{6}$/u)
    await expect(deriveInitialPassword({ admissionYear: 2026, phone: '010-1234-4225' }))
      .resolves.toBe(issued)
  })

  it('increments a credential revision without changing the initial PIN rule', () => {
    expect(nextPasswordGeneration(1)).toBe(2)
    expect(nextPasswordGeneration(2_147_483_646)).toBe(2_147_483_647)
    expect(() => nextPasswordGeneration(2_147_483_647)).toThrow('PASSWORD_GENERATION_EXHAUSTED')
  })

  it('accepts new numeric PINs while retaining already-issued legacy credentials', () => {
    expect(rosterPasswordSchema.safeParse('269442').success).toBe(true)
    expect(rosterPasswordSchema.safeParse('9442AB').success).toBe(true)
    expect(rosterPasswordSchema.safeParse('26944').success).toBe(false)
    expect(rosterPasswordSchema.safeParse('26944A').success).toBe(false)
  })

  it('rejects password peppers that are not exactly 32 bytes', async () => {
    await expect(derivePasswordDigest('4225AB', new Uint8Array(31)))
      .rejects.toThrowError('CRYPTO_SECRET_INVALID')
    await expect(deriveInitialPassword({ admissionYear: 1999, phone: '01012344225' }))
      .rejects.toThrowError('ADMISSION_YEAR_INVALID')
  })

  it('does not introduce PBKDF2 into roster credential derivation', () => {
    const source = readFileSync('server/modules/identity/roster-credentials.ts', 'utf8')

    expect(source).not.toMatch(/PBKDF2/iu)
  })
})
