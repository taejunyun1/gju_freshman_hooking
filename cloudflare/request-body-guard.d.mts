export const MAX_REQUEST_BODY_BYTES: number
export const DEFAULT_MAX_REQUEST_BODY_BYTES: number
export const requestBodyOverflowHeader: string

type WorkerLike<Environment = unknown, Context = unknown> = {
  fetch: (request: Request, environment: Environment, context: Context) => Promise<Response> | Response
  [key: string]: unknown
}

export function createBodyGuardWorker<Environment = unknown, Context = unknown>(
  worker: WorkerLike<Environment, Context>,
): WorkerLike<Environment, Context>
