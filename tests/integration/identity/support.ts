type Prospect = {
  id: number
  nickname: string
  phoneHmac: Uint8Array
}

type Credential = {
  prospectId: number
  passwordHash: Uint8Array
  passwordSalt: Uint8Array
  failedAttempts: number
  lockedUntil: Date | null
}

const bytesKey = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')

export const createMemoryBackend = () => {
  const prospects = new Map<string, Prospect>()
  const credentials = new Map<number, Credential>()
  let prospectId = 0

  return {
    dependencies: {
      hmacKey: new Uint8Array(32).fill(1),
      encryptionKey: new Uint8Array(32).fill(2),
      passwordPepper: new Uint8Array(32).fill(3),
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      consumeRateLimit: async () => true,
      findProspectByPhoneHmac: async (phoneHmac: Uint8Array) => prospects.get(bytesKey(phoneHmac)) ?? null,
      isNicknameAvailable: async (nickname: string) => ![...prospects.values()].some((prospect) => prospect.nickname === nickname),
      registerStudent: async (input: {
        phoneHmac: Uint8Array
        phoneCiphertext: Uint8Array
        phoneIv: Uint8Array
        nickname: string
        schoolName: string
        applicantStage: string
        region: string
        passwordHash: Uint8Array
        passwordSalt: Uint8Array
      }) => {
        const key = bytesKey(input.phoneHmac)
        if (prospects.has(key)) return { kind: 'existing' as const }

        const prospect: Prospect = { id: ++prospectId, nickname: input.nickname, phoneHmac: input.phoneHmac }
        prospects.set(key, prospect)
        credentials.set(prospect.id, {
          prospectId: prospect.id,
          passwordHash: input.passwordHash,
          passwordSalt: input.passwordSalt,
          failedAttempts: 0,
          lockedUntil: null,
        })
        return { kind: 'created' as const }
      },
      findCredentialByPhoneHmac: async (phoneHmac: Uint8Array) => {
        const prospect = prospects.get(bytesKey(phoneHmac))
        if (!prospect) return null
        const credential = credentials.get(prospect.id)
        return credential ? { ...credential, nickname: prospect.nickname } : null
      },
      recordLoginFailure: async (phoneHmac: Uint8Array, now: Date) => {
        const prospect = prospects.get(bytesKey(phoneHmac))
        const credential = prospect ? credentials.get(prospect.id) : undefined
        if (!credential || (credential.lockedUntil && credential.lockedUntil > now)) return null

        credential.failedAttempts += 1
        if (credential.failedAttempts >= 5) credential.lockedUntil = new Date(now.getTime() + 15 * 60 * 1000)
        return { lockedUntil: credential.lockedUntil }
      },
      completeLogin: async (input: {
        prospectId: number
        tokenHash: Uint8Array
        expiresAt: Date
        idleExpiresAt: Date
        now: Date
      }) => {
        const credential = credentials.get(input.prospectId)
        if (!credential || (credential.lockedUntil && credential.lockedUntil > input.now)) return null
        credential.failedAttempts = 0
        credential.lockedUntil = null
        return { expiresAt: input.expiresAt }
      },
      readSession: async () => null,
      revokeSession: async () => undefined,
      writeEvent: async () => undefined,
    },
    countProspects: () => prospects.size,
    readCredential: () => [...credentials.values()][0] ?? null,
  }
}
