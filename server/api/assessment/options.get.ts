import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import type { PublicAssessmentCatalog } from '../../modules/assessment/service'
import { getServerAssessmentService } from '../../modules/assessment/service'
import { toApiFailure } from '../../utils/app-error'

type OptionsHandlerDependencies = {
  assessment: Pick<ReturnType<typeof getServerAssessmentService>, 'getOptions'>
  getRequestId: (event: unknown) => string
  setStatus: (event: unknown, status: number) => void
}

export const createOptionsHandler = (dependencies: OptionsHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<PublicAssessmentCatalog> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    return { data: await dependencies.assessment.getOptions(), requestId }
  }
  catch (error) {
    dependencies.setStatus(event, 500)
    return toApiFailure(error, requestId)
  }
}

export default defineEventHandler(event => createOptionsHandler({
  assessment: getServerAssessmentService(),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
