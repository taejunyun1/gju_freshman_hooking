import type { AssessmentOption } from '../../../shared/types/domain'
import { sha256, utf8 } from '../../utils/web-crypto'

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]),
    )
  }

  return value
}

const hexEncode = (value: Uint8Array) => Array.from(
  value,
  byte => byte.toString(16).padStart(2, '0'),
).join('')

export const createAssessmentCatalogRevision = async (
  catalog: readonly AssessmentOption[],
): Promise<string> => `sha256:${hexEncode(await sha256(utf8(JSON.stringify(canonicalize(catalog)))))}`
