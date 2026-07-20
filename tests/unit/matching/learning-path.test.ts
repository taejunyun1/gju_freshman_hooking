import { describe, expect, it } from 'vitest'
import { buildLearningPath } from '../../../server/modules/matching/learning-path'
import { courseResultResourceSchema } from '../../../shared/schemas/result'
import type { CourseResultResource } from '../../../shared/types/result'

const course = (
  id: number,
  gradeYear: 1 | 2 | 3 | 4,
  affinity: number,
  sourceDate = '2026-07-14',
): CourseResultResource => ({
  id,
  type: 'course',
  title: `교과 ${id}`,
  summary: `교과 ${id} 요약`,
  sourceDate,
  affinity,
  primaryTag: `tag_${id}`,
  connectionReason: `선택 관심이 교과 ${id} ‘교과 ${id}’과 연결됩니다.`,
  displayMetadata: { gradeYear, term: '1학기', credits: 3 },
})

describe('four-year learning path', () => {
  it('always returns ordered years and preserves an explicit empty year', () => {
    const path = buildLearningPath([
      course(4, 4, 70),
      course(3, 3, 80),
      course(1, 1, 90),
    ])

    expect(path.map(bucket => bucket.year)).toEqual([1, 2, 3, 4])
    expect(path.map(bucket => bucket.resources.map(item => item.id))).toEqual([
      [1],
      [],
      [3],
      [4],
    ])
  })

  it('uses confirmed grade only and is deterministic across input permutations', () => {
    const misleadingTitle = {
      ...course(2, 1, 60),
      title: '4학년 현장실습으로 보이는 제목',
      connectionReason: '선택 관심이 교과 2 ‘4학년 현장실습으로 보이는 제목’과 연결됩니다.',
    }
    const courses = [
      course(6, 3, 80, '2026-07-01'),
      course(5, 3, 80, '2026-07-01'),
      course(7, 3, 80, '2026-07-02'),
      course(10, 3, 90, '2026-06-01'),
      misleadingTitle,
    ]
    const first = buildLearningPath(courses)
    const second = buildLearningPath([...courses].reverse())

    expect(first[2].resources.map(item => item.id)).toEqual([10, 7, 5, 6])
    expect(second.map(bucket => bucket.resources.map(item => item.id)))
      .toEqual(first.map(bucket => bucket.resources.map(item => item.id)))
    expect(first[0].resources.map(item => item.id)).toEqual([2])
    expect(first[3].resources).toEqual([])
  })

  it('orders courses in the same year by confirmed term before affinity', () => {
    const path = buildLearningPath([
      { ...course(1, 3, 100), displayMetadata: { gradeYear: 3, term: '2학기', credits: 3 } },
      { ...course(2, 3, 10), displayMetadata: { gradeYear: 3, term: '1학기', credits: 3 } },
    ])

    expect(path[2].resources.map(item => item.id)).toEqual([2, 1])
  })

  it('rejects an invalid confirmed grade year', () => {
    const invalidYear = {
      ...course(1, 1, 80),
      displayMetadata: { gradeYear: 5, term: '1학기', credits: 3 },
    } as unknown as CourseResultResource
    expect(() => buildLearningPath([invalidYear])).toThrow(/year|학년/iu)
  })

  it('rejects duplicate resource IDs even when their years differ', () => {
    expect(() => buildLearningPath([
      course(1, 1, 80),
      course(1, 2, 70),
    ])).toThrow(/duplicate|중복/iu)
  })

  it('rejects non-course and malformed canonical resources', () => {
    const nonCourse = {
      ...course(20, 1, 80),
      type: 'facility',
      displayMetadata: { locationLabel: '학과', operationNote: '학과 확인 필요' },
    } as unknown as CourseResultResource
    const malformedAffinity = {
      ...course(21, 1, 80),
      affinity: 80.01,
    } as CourseResultResource

    expect(() => buildLearningPath([nonCourse])).toThrow(/canonical|course|교과/iu)
    expect(() => buildLearningPath([malformedAffinity])).toThrow(/canonical|course|교과/iu)
  })

  it('deep-clones and freezes course resources before exposing the path', () => {
    const mutable = course(30, 2, 90) as unknown as {
      title: string
      displayMetadata: { gradeYear: 1 | 2 | 3 | 4, term: string, credits: number }
    }
    const path = buildLearningPath([mutable as CourseResultResource])
    const result = path[1].resources[0]!

    expect(result).not.toBe(mutable)
    expect(result.displayMetadata).not.toBe(mutable.displayMetadata)
    expect(courseResultResourceSchema.safeParse(result).success).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.displayMetadata)).toBe(true)

    mutable.title = '호출자가 바꾼 제목'
    mutable.displayMetadata.term = '호출자가 바꾼 학기'
    expect(result.title).toBe('교과 30')
    expect(result.displayMetadata.term).toBe('1학기')
  })
})
