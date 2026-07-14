export const postgresByteaFromBytes = (bytes: Uint8Array): string => (
  `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
)

export const bytesFromPostgresBytea = (value: string): Uint8Array => {
  if (!/^\\x(?:[0-9a-f]{2})*$/iu.test(value)) throw new Error('POSTGRES_BYTEA_INVALID')
  return Uint8Array.from(value.slice(2).match(/.{2}/gu) ?? [], byte => Number.parseInt(byte, 16))
}
