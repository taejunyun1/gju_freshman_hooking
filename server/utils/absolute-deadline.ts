export type DeadlineRunner = <Value>(
  operation: () => Promise<Value>,
  remainingMs: number,
) => Promise<Value>

export type AbsoluteDeadline = {
  readonly expiresAt: number
  now: () => number
  remaining: () => number
  run: <Value>(operation: () => Promise<Value>) => Promise<Value>
}

export const deadlineExceeded = (): Error => (
  new Error('ASSESSMENT_SUBMIT_DEADLINE_EXCEEDED')
)

export const isDeadlineExceeded = (error: unknown): boolean => (
  error instanceof Error && error.message === 'ASSESSMENT_SUBMIT_DEADLINE_EXCEEDED'
)

export const defaultDeadlineRunner: DeadlineRunner = async <Value>(
  operation: () => Promise<Value>,
  remainingMs: number,
): Promise<Value> => {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw deadlineExceeded()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(deadlineExceeded()), remainingMs)
      }),
    ])
  }
  finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export const createAbsoluteDeadline = (input: {
  durationMs: number
  monotonicNow: () => number
  runWithDeadline: DeadlineRunner
}): AbsoluteDeadline => {
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1) {
    throw new Error('ABSOLUTE_DEADLINE_INVALID')
  }
  const expiresAt = input.monotonicNow() + input.durationMs
  const remaining = () => Math.max(0, Math.floor(expiresAt - input.monotonicNow()))
  return {
    expiresAt,
    now: input.monotonicNow,
    remaining,
    run: <Value>(operation: () => Promise<Value>): Promise<Value> => {
      const available = remaining()
      return available <= 0
        ? Promise.reject(deadlineExceeded())
        : input.runWithDeadline(operation, available)
    },
  }
}
