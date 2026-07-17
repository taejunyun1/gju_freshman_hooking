export type NormalizedApplicantStage = 'high1' | 'high2' | 'high3' | 'graduate' | 'ged' | 'other'

const applicantStageValues: Readonly<Record<string, NormalizedApplicantStage>> = {
  high1: 'high1',
  high2: 'high2',
  high3: 'high3',
  graduate: 'graduate',
  ged: 'ged',
  other: 'other',
  고1: 'high1',
  고2: 'high2',
  고3: 'high3',
  졸업: 'graduate',
  검정고시: 'ged',
  기타: 'other',
}

export const normalizeApplicantName = (input: string): string => {
  const value = input.normalize('NFKC').trim().replace(/\p{White_Space}+/gu, ' ')
  if ([...value].length < 1 || [...value].length > 40 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error('APPLICANT_NAME_INVALID')
  }
  return value
}

export const normalizeKoreanPhone = (phone: string): string => {
  const normalized = phone.replace(/[\p{White_Space}-]+/gu, '')
  if (!/^010\d{8}$/u.test(normalized)) throw new Error('PHONE_INVALID')

  return normalized
}

export const normalizeApplicantStage = (input: string): NormalizedApplicantStage => {
  const normalized = input.normalize('NFKC').trim()
  const stage = applicantStageValues[normalized]
  if (stage === undefined) throw new Error('APPLICANT_STAGE_INVALID')

  return stage
}
