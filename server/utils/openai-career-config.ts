import {
  base64urlEncode,
  decodeBase64urlSecret,
  hmacSha256,
  utf8,
} from './web-crypto'

export type OpenAiCareerModel = 'gpt-5.6-sol' | 'gpt-5.6-luna'

export type OpenAiCareerConfig =
  | {
      enabled: false
      failureCode: 'missing_config'
    }
  | {
      enabled: true
      apiKey: string
      safetyHmacKey: Uint8Array
      model: OpenAiCareerModel
      timeoutMs: number
      dailyCap: number
      prospectCap: 5
      maxOutputTokens: 512
    }

type Environment = Readonly<Record<string, string | undefined>>

const disabledConfig = (): OpenAiCareerConfig => ({
  enabled: false,
  failureCode: 'missing_config',
})

const boundedInteger = (
  raw: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number | null => {
  if (raw === undefined || raw === '') return defaultValue
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null
}

const decodeExactHmacKey = (raw: string): Uint8Array | null => {
  try {
    const decoded = decodeBase64urlSecret(raw)
    return decoded.byteLength === 32 ? decoded : null
  }
  catch {
    return null
  }
}

export const loadOpenAiCareerConfig = (
  env: Environment = process.env,
): OpenAiCareerConfig => {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? ''
  const encodedHmacKey = env.OPENAI_SAFETY_HMAC_KEY?.trim() ?? ''
  if (apiKey === '' || encodedHmacKey === '') return disabledConfig()

  const safetyHmacKey = decodeExactHmacKey(encodedHmacKey)
  const rawModel = env.OPENAI_CAREER_NARRATIVE_MODEL?.trim() || 'gpt-5.6-sol'
  const model = rawModel === 'gpt-5.6-sol' || rawModel === 'gpt-5.6-luna'
    ? rawModel
    : null
  const timeoutMs = boundedInteger(
    env.OPENAI_CAREER_NARRATIVE_TIMEOUT_MS?.trim(),
    5_000,
    2_000,
    8_000,
  )
  const dailyCap = boundedInteger(
    env.OPENAI_CAREER_NARRATIVE_DAILY_CAP?.trim(),
    500,
    1,
    10_000,
  )
  const prospectCap = boundedInteger(
    env.OPENAI_CAREER_NARRATIVE_PROSPECT_CAP?.trim(),
    5,
    5,
    5,
  )

  if (
    safetyHmacKey === null
    || model === null
    || timeoutMs === null
    || dailyCap === null
    || prospectCap !== 5
  ) {
    return disabledConfig()
  }

  return {
    enabled: true,
    apiKey,
    safetyHmacKey,
    model,
    timeoutMs,
    dailyCap,
    prospectCap: 5,
    maxOutputTokens: 512,
  }
}

export const createSafetyIdentifier = async (
  prospectId: number,
  safetyHmacKey: Uint8Array,
): Promise<string> => {
  if (
    !Number.isSafeInteger(prospectId)
    || prospectId <= 0
    || safetyHmacKey.byteLength !== 32
  ) {
    throw new Error('OPENAI_SAFETY_IDENTIFIER_INPUT_INVALID')
  }
  const material = utf8(`PHOTO:NEXT/openai-safety/v1\n${prospectId}`)
  const digest = await hmacSha256(material, safetyHmacKey)
  return `pn_${base64urlEncode(digest)}`
}
