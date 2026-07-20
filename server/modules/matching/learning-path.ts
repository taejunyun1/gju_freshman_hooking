import { courseResultResourceSchema } from '../../../shared/schemas/result'
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

const termOrder = (term: string): number => (
  term === '1학기' ? 1 : term === '2학기' ? 2 : 3
)

const compareCourses = (left: CourseResultResource, right: CourseResultResource): number => (
  termOrder(left.displayMetadata.term) - termOrder(right.displayMetadata.term)
  || left.displayMetadata.term.localeCompare(right.displayMetadata.term, 'ko')
  || right.affinity - left.affinity
  || right.sourceDate.localeCompare(left.sourceDate, 'en')
  || left.id - right.id
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const canonicalCourseCopy = (value: unknown): CourseResultResource => {
  if (!isRecord(value) || value.type !== 'course') {
    throw new Error('Course resource must have the canonical course type')
  }
  const metadata = value.displayMetadata
  if (!isRecord(metadata) || !isGradeYear(metadata.gradeYear)) {
    throw new Error('Course grade year must be between 1 and 4')
  }

  const parsed = courseResultResourceSchema.safeParse(value)
  if (!parsed.success) throw new Error('Course resource must match the canonical result schema')
  return Object.freeze({
    ...parsed.data,
    displayMetadata: Object.freeze({ ...parsed.data.displayMetadata }),
  }) as CourseResultResource
}

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

  for (const value of courses) {
    const course = canonicalCourseCopy(value)
    if (ids.has(course.id)) throw new Error('Duplicate course resource ID')
    ids.add(course.id)

    grouped[course.displayMetadata.gradeYear].push(course)
  }

  return Object.freeze(([1, 2, 3, 4] as const).map(year => Object.freeze({
    year,
    resources: Object.freeze([...grouped[year]].sort(compareCourses)),
  }))) as LearningPath
}
