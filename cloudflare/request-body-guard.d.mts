export const MAX_REQUEST_BODY_BYTES: number
export const DEFAULT_MAX_REQUEST_BODY_BYTES: number
export const RESOURCE_IMPORT_MAX_REQUEST_BODY_BYTES: number
export const RESOURCE_IMAGE_MAX_REQUEST_BODY_BYTES: number
export const RESOURCE_TRANSITION_MAX_REQUEST_BODY_BYTES: number
export const FACULTY_MUTATION_MAX_REQUEST_BODY_BYTES: number
export const FACULTY_TRANSITION_MAX_REQUEST_BODY_BYTES: number
export const requestBodyOverflowHeader: string

type WorkerLike<Environment = unknown, Context = unknown> = {
  fetch: (request: Request, environment: Environment, context: Context) => Promise<Response> | Response
  [key: string]: unknown
}

export function createBodyGuardWorker<Environment = unknown, Context = unknown>(
  worker: WorkerLike<Environment, Context>,
): WorkerLike<Environment, Context>
