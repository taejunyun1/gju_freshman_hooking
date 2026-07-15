import type { ApiFailure } from '../../shared/types/api'
import type { AdminCounselingCurrent } from '../../shared/schemas/counseling'
import type { AdminEquipmentInventoryItem, AdminResource } from '../../shared/schemas/admin-resources'

type AppErrorCode = ApiFailure['error']['code']

const publicMessages: Record<AppErrorCode, string> = {
  AUTH_FAILED: '입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.',
  VALIDATION_FAILED: '입력 항목을 다시 확인해 주세요.',
  RATE_LIMITED: '잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '잠시 후 다시 시도해 주세요.',
  ADMIN_REQUIRED: '관리자 권한을 확인할 수 없습니다.',
  MFA_REQUIRED: '추가 인증이 필요합니다.',
  REAUTH_REQUIRED: '최근 인증이 필요합니다.',
  RECOVERY_INVALID: '복구 정보를 확인하거나 새 복구 코드를 요청해 주세요.',
  ASSESSMENT_INVALID: '평가 응답을 다시 확인해 주세요.',
  ASSESSMENT_CATALOG_STALE: '평가 선택지가 변경되었습니다. 다시 확인해 주세요.',
  RESULT_NOT_FOUND: '요청한 결과를 찾을 수 없습니다.',
  COUNSELING_INVALID: '상담 신청 내용을 다시 확인해 주세요.',
  COUNSELING_NOT_FOUND: '요청한 상담 내역을 찾을 수 없습니다.',
  COUNSELING_CONFLICT: '상담 처리 상태가 변경되었습니다. 최신 내용을 확인해 주세요.',
  STUDENT_INVALID: '학생 검색 조건을 다시 확인해 주세요.',
  STUDENT_NOT_FOUND: '요청한 학생 정보를 찾을 수 없습니다.',
  RESOURCE_INVALID: '자원 입력값을 다시 확인해 주세요.',
  RESOURCE_NOT_FOUND: '요청한 자원을 찾을 수 없습니다.',
  RESOURCE_CONFLICT: '자원이 이미 변경되었습니다. 최신 내용을 확인해 주세요.',
  RESOURCE_SOURCE_REQUIRED: '게시하려면 출처 날짜가 필요합니다.',
  RESOURCE_PRIMARY_TAG_REQUIRED: '게시하려면 기본 태그가 하나 필요합니다.',
  COURSE_METADATA_REQUIRED: '교과 운영 정보를 모두 입력해 주세요.',
  WORK_CONSENT_REQUIRED: '학생 작품 게시 동의가 필요합니다.',
  WORK_MEDIA_REQUIRED: '학생 작품 이미지와 대체 텍스트가 필요합니다.',
  WORK_RELATION_REQUIRED: '학생 작품의 교과·학년·트랙 연결 정보가 필요합니다.',
  EQUIPMENT_INVENTORY_UNVERIFIED: '검증된 기자재 재고가 필요합니다.',
  FACILITY_OPERATION_UNVERIFIED: '시설 운영 정보와 검증 일시를 확인해 주세요.',
  RESOURCE_IMAGE_INVALID: '이미지 형식을 확인해 주세요.',
  RESOURCE_IMAGE_TOO_LARGE: '이미지는 8MiB 이하여야 합니다.',
  RESOURCE_IMAGE_UPLOAD_FAILED: '이미지를 저장하지 못했습니다.',
  EQUIPMENT_IMPORT_INVALID: '기자재 가져오기 자료를 확인해 주세요.',
}

const statusCodes: Record<AppErrorCode, number> = {
  AUTH_FAILED: 401,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  ADMIN_REQUIRED: 403,
  MFA_REQUIRED: 403,
  REAUTH_REQUIRED: 403,
  RECOVERY_INVALID: 401,
  ASSESSMENT_INVALID: 422,
  ASSESSMENT_CATALOG_STALE: 409,
  RESULT_NOT_FOUND: 404,
  COUNSELING_INVALID: 422,
  COUNSELING_NOT_FOUND: 404,
  COUNSELING_CONFLICT: 409,
  STUDENT_INVALID: 422,
  STUDENT_NOT_FOUND: 404,
  RESOURCE_INVALID: 422,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_CONFLICT: 409,
  RESOURCE_SOURCE_REQUIRED: 422,
  RESOURCE_PRIMARY_TAG_REQUIRED: 422,
  COURSE_METADATA_REQUIRED: 422,
  WORK_CONSENT_REQUIRED: 422,
  WORK_MEDIA_REQUIRED: 422,
  WORK_RELATION_REQUIRED: 422,
  EQUIPMENT_INVENTORY_UNVERIFIED: 422,
  FACILITY_OPERATION_UNVERIFIED: 422,
  RESOURCE_IMAGE_INVALID: 422,
  RESOURCE_IMAGE_TOO_LARGE: 413,
  RESOURCE_IMAGE_UPLOAD_FAILED: 500,
  EQUIPMENT_IMPORT_INVALID: 422,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly statusCode: number

  constructor(code: AppErrorCode) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCodes[code]
  }
}

export class CounselingConflictError extends AppError {
  readonly current: AdminCounselingCurrent

  constructor(current: AdminCounselingCurrent) {
    super('COUNSELING_CONFLICT')
    this.name = 'CounselingConflictError'
    this.current = current
  }
}

export class ResourceConflictError extends AppError {
  readonly current: AdminResource

  constructor(current: AdminResource) {
    super('RESOURCE_CONFLICT')
    this.name = 'ResourceConflictError'
    this.current = current
  }
}

export class InventoryConflictError extends AppError {
  readonly current: AdminEquipmentInventoryItem

  constructor(current: AdminEquipmentInventoryItem) {
    super('RESOURCE_CONFLICT')
    this.name = 'InventoryConflictError'
    this.current = current
  }
}

export const toAppError = (error: unknown): AppError => error instanceof AppError ? error : new AppError('INTERNAL_ERROR')

export const toApiFailure = (error: unknown, requestId: string): ApiFailure => {
  const appError = toAppError(error)
  return {
    error: {
      code: appError.code,
      message: publicMessages[appError.code],
      ...(
        appError instanceof CounselingConflictError
        || appError instanceof ResourceConflictError
        || appError instanceof InventoryConflictError
          ? { current: appError.current }
          : {}
      ),
    },
    requestId,
  }
}
