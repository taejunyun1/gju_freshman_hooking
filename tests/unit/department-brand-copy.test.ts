import { describe, expect, it } from 'vitest'
import {
  ADMIN_HOME_ARIA_LABEL,
  DEPARTMENT_NAME,
  DEPARTMENT_SERVICE_BRAND,
  DOCUMENT_BRAND,
  HOME_ARIA_LABEL,
  SERVICE_NAME,
} from '../../shared/constants/department-brand'

describe('department brand copy', () => {
  it('keeps the department as the owner and PHOTO:NEXT as the service', () => {
    expect(DEPARTMENT_NAME).toBe('광주대학교 사진영상미디어학과')
    expect(SERVICE_NAME).toBe('PHOTO:NEXT')
    expect(DEPARTMENT_SERVICE_BRAND).toBe('광주대학교 사진영상미디어학과 · PHOTO:NEXT')
    expect(DOCUMENT_BRAND).toBe('광주대학교 사진영상미디어학과 | PHOTO:NEXT')
    expect(HOME_ARIA_LABEL).toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 홈')
    expect(ADMIN_HOME_ARIA_LABEL).toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 관리자 홈')
  })
})
