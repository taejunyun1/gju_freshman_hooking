import { describe, expect, it } from 'vitest'

import { AppError, toApiFailure } from '../../../server/utils/app-error'

describe('AppError', () => {
  it('publishes the stable assessment idempotency conflict without private hashes or jobs', () => {
    const error = new AppError('ASSESSMENT_IDEMPOTENCY_CONFLICT')
    const failure = toApiFailure(error, '77777777-7777-4777-8777-777777777777')

    expect(error.statusCode).toBe(409)
    expect(failure).toEqual({
      error: {
        code: 'ASSESSMENT_IDEMPOTENCY_CONFLICT',
        message: '같은 제출 요청의 평가 내용이 달라졌습니다. 평가를 다시 시작해 주세요.',
      },
      requestId: '77777777-7777-4777-8777-777777777777',
    })
    expect(JSON.stringify(failure)).not.toMatch(/sha256|generation|claim|provider|token/iu)
  })
})
