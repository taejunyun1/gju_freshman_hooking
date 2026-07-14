import type { ApplicantStage, Region } from '../schemas/identity'

export type RegistrationInput = {
  phone: string
  schoolName: string
  applicantStage: ApplicantStage
  region: Region
}

export type LoginInput = {
  phone: string
  password: string
}

export type RegistrationResult =
  | { kind: 'created', nickname: string, initialPassword: string }
  | { kind: 'existing' }

export type LoginResult =
  | { kind: 'authenticated', sessionToken: string, expiresAt: string }
  | { kind: 'failed' }

export type StudentSession = {
  csrfToken: string
  prospectId: number
  nickname: string
  expiresAt: string
}

export type ApiSuccess<T> = {
  data: T
  requestId: string
}

export type ApiFailure = {
  error: {
    code: 'AUTH_FAILED' | 'VALIDATION_FAILED' | 'RATE_LIMITED' | 'INTERNAL_ERROR' | 'ADMIN_REQUIRED' | 'MFA_REQUIRED' | 'REAUTH_REQUIRED' | 'RECOVERY_INVALID'
    message: string
  }
  requestId: string
}
