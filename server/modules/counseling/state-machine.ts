import type { CounselingStatus } from '../../../shared/types/domain'

const allowed = {
  new: ['assigned', 'closed'],
  assigned: ['contacted', 'closed'],
  contacted: ['completed', 'closed'],
  completed: [],
  closed: [],
} as const satisfies Readonly<Record<CounselingStatus, readonly CounselingStatus[]>>

export const assertTransition = (
  from: CounselingStatus,
  to: CounselingStatus,
  reopenReason?: string,
): void => {
  if ((from === 'completed' || from === 'closed') && to === 'new') {
    if (reopenReason?.trim() === '') throw new Error('COUNSELING_REOPEN_REASON_REQUIRED')
    if (reopenReason === undefined) throw new Error('COUNSELING_REOPEN_REASON_REQUIRED')
    return
  }

  const normalTransitions: readonly CounselingStatus[] = allowed[from]
  if (!normalTransitions.includes(to)) throw new Error('COUNSELING_TRANSITION_INVALID')
}
