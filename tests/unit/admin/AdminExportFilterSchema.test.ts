import { describe, expect, it } from 'vitest'

import { adminExportFilterSchema } from '../../../shared/schemas/admin-export'

describe('administrator export filter schema', () => {
  it('accepts the operational target and assigned-faculty selectors', () => {
    expect(adminExportFilterSchema.safeParse({
      exportSegment: 'counseling_requested',
      assignedFaculty: 7,
    }).success).toBe(true)
    expect(adminExportFilterSchema.safeParse({
      exportSegment: 'completed_without_counseling',
      assignedFaculty: 'unassigned',
    }).success).toBe(true)
    expect(adminExportFilterSchema.safeParse({
      exportSegment: 'not_completed',
    }).success).toBe(true)
    expect(adminExportFilterSchema.safeParse({}).success).toBe(true)
  })

  it.each([
    { exportSegment: 'completed' },
    { assignedFaculty: 0 },
    { assignedFaculty: -1 },
    { assignedFaculty: '7' },
    { assignedFaculty: 'all' },
  ])('rejects invalid operational selector %j', (filter) => {
    expect(adminExportFilterSchema.safeParse(filter).success).toBe(false)
  })
})
