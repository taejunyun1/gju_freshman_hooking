import type { CourseResultResource, LearningPathYear } from '../../../shared/types/result'

export type LearningPath = readonly [
  LearningPathYear,
  LearningPathYear,
  LearningPathYear,
  LearningPathYear,
]

const isGradeYear = (value: unknown): value is 1 | 2 | 3 | 4 => (
  value === 1 || value === 2 || value === 3 || value === 4
)

const compareCourses = (left: CourseResultResource, right: CourseResultResource): number => (
  right.affinity - left.affinity
  || right.sourceDate.localeCompare(left.sourceDate, 'en')
  || left.id - right.id
)

export const buildLearningPath = (
  courses: readonly CourseResultResource[],
): LearningPath => {
  const ids = new Set<number>()
  const grouped: Record<1 | 2 | 3 | 4, CourseResultResource[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
  }

  for (const course of courses) {
    if (ids.has(course.id)) throw new Error('Duplicate course resource ID')
    ids.add(course.id)

    const year = course.displayMetadata.gradeYear
    if (!isGradeYear(year)) throw new Error('Course grade year must be between 1 and 4')
    grouped[year].push(course)
  }

  return Object.freeze(([1, 2, 3, 4] as const).map(year => Object.freeze({
    year,
    resources: Object.freeze([...grouped[year]].sort(compareCourses)),
  }))) as LearningPath
}
