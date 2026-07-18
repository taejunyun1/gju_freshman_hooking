import type { ResultSnapshot } from '../../../shared/types/result'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import { equipmentCategoryOf } from '../../../shared/utils/equipment-category'

export interface EnvironmentScoreInput {
  readonly facility: ResultSnapshot['resources']['facility']
  readonly equipment: ResultSnapshot['resources']['equipment']
  readonly learningPath: ResultSnapshot['learningPath']
  readonly hasPrimaryFaculty: boolean
}

export const computeEnvironmentScore = (input: EnvironmentScoreInput): number => {
  const categories = new Set(input.equipment.map(equipmentCategoryOf))
  const years = new Set(input.learningPath
    .filter(year => year.resources.length > 0)
    .map(year => year.year))
  const raw = (input.facility.length > 0 ? 35 : 0)
    + (categories.has('body') ? 15 : 0)
    + (categories.has('lens') ? 15 : 0)
    + Math.min(years.size, 4) * 6.25
    + (input.hasPrimaryFaculty ? 10 : 0)
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10
}

export const withComputedEnvironmentScore = (snapshot: ResultSnapshot): ResultSnapshot => (
  decodeResultSnapshot({
    ...snapshot,
    environmentScore: computeEnvironmentScore({
      facility: snapshot.resources.facility,
      equipment: snapshot.resources.equipment,
      learningPath: snapshot.learningPath,
      hasPrimaryFaculty: snapshot.faculty.primary.id > 0,
    }),
  })
)
