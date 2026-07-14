import { createHash } from 'node:crypto'

type PlaywrightTestIdentity = {
  retry: number
  testId: string
}

export const uniqueAssessmentPhone = (testInfo: PlaywrightTestIdentity): string => {
  const digest = createHash('sha256')
    .update(`${testInfo.testId}:${testInfo.retry}`)
    .digest()
  const suffix = (digest.readUInt32BE(0) % 10_000_000).toString().padStart(7, '0')
  return `0108${suffix}`
}
