export const minorRolloutApprovalIdPattern = /^minor-rollout:\d{4}-\d{2}-\d{2}:[A-Za-z0-9._-]{3,80}$/u

export const isMinorRolloutApprovalId = (value: string): boolean => (
  minorRolloutApprovalIdPattern.test(value)
)
