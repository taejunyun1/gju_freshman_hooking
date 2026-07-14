import { describe, expect, it } from 'vitest'

describe('PostgREST bytea transport', () => {
  it('encodes a 32-byte payload as exact PostgreSQL hex and decodes it without changes', async () => {
    const { bytesFromPostgresBytea, postgresByteaFromBytes } = await import('../../../server/utils/postgres-bytea')
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index)
    const encoded = postgresByteaFromBytes(bytes)

    expect(encoded).toBe(`\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`)
    expect(encoded).toHaveLength(66)
    expect(bytesFromPostgresBytea(encoded)).toEqual(bytes)
  })

  it('rejects a non-hex PostgREST bytea response', async () => {
    const { bytesFromPostgresBytea } = await import('../../../server/utils/postgres-bytea')

    expect(() => bytesFromPostgresBytea('base64-is-not-postgres-bytea')).toThrowError('POSTGRES_BYTEA_INVALID')
  })
})
