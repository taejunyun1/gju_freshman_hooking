import { z } from 'zod'

import {
  facultyRoles,
  questionGroups,
  trackKeys,
} from '../types/domain'
import type { ResultSnapshot } from '../types/result'

const boundedText = (minimum: number, maximum: number) => z.string()
  .min(minimum)
  .max(maximum)
  .refine(value => value === value.trim(), '앞뒤 공백을 제거해 주세요.')

const safeIdSchema = z.number().int().positive().safe()
const finiteScoreSchema = z.number().finite().min(0).max(100)
const tagKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)
const safeRelativePathSchema = z.string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
  .refine(path => !/(^|\/)\.{1,2}(\/|$)/u.test(path), '상대 경로 이동은 허용되지 않습니다.')
  .refine(path => !path.includes('//'), '빈 경로 구간은 허용되지 않습니다.')

const publicHttpsUrlSchema = boundedText(8, 500).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.hash === ''
  }
  catch {
    return false
  }
}, '공개 웹사이트는 안전한 HTTPS URL이어야 합니다.')

const optionKeySchemas = {
  work: z.string().max(71).regex(/^work\.[a-z][a-z0-9_]*$/u),
  result: z.string().max(71).regex(/^result\.[a-z][a-z0-9_]*$/u),
  style: z.string().max(71).regex(/^style\.[a-z][a-z0-9_]*$/u),
  career: z.string().max(71).regex(/^career\.[a-z][a-z0-9_]*$/u),
} as const

export const selectedInterestSchema = z.discriminatedUnion('group', [
  z.object({ group: z.literal('work'), key: optionKeySchemas.work, label: boundedText(1, 200) }).strict(),
  z.object({ group: z.literal('result'), key: optionKeySchemas.result, label: boundedText(1, 200) }).strict(),
  z.object({ group: z.literal('style'), key: optionKeySchemas.style, label: boundedText(1, 200) }).strict(),
  z.object({ group: z.literal('career'), key: optionKeySchemas.career, label: boundedText(1, 200) }).strict(),
])

export const trackScoresSchema = z.object({
  documentary: finiteScoreSchema,
  art_photo: finiteScoreSchema,
  commercial: finiteScoreSchema,
  video: finiteScoreSchema,
}).strict()

const resultResourceBaseShape = {
  id: safeIdSchema,
  title: boundedText(1, 200),
  summary: boundedText(1, 1000),
  sourceDate: z.iso.date(),
  affinity: finiteScoreSchema,
  primaryTag: tagKeySchema,
  connectionReason: boundedText(1, 1000)
    .refine(reason => !/[{}]/u.test(reason), '연결 이유에 미완성 템플릿이 남아 있습니다.'),
}

const renderedReasonCheck = (
  resource: { title: string, connectionReason: string },
  context: z.RefinementCtx,
) => {
  if (!resource.connectionReason.includes(resource.title)) {
    context.addIssue({
      code: 'custom',
      message: '연결 이유에는 표시되는 자원 제목이 포함되어야 합니다.',
      path: ['connectionReason'],
    })
  }
}

const courseDisplayMetadataSchema = z.object({
  gradeYear: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  term: boundedText(1, 20),
  credits: z.number().finite().min(0).max(30),
}).strict()

const capabilityDisplayMetadataSchema = z.object({
  locationLabel: boundedText(1, 120),
  accessLabel: boundedText(1, 120),
}).strict()

const studentWorkDisplayMetadataSchema = z.object({
  imagePath: safeRelativePathSchema,
  imageAlt: boundedText(1, 200),
}).strict()

const emptyDisplayMetadataSchema = z.object({}).strict()

export const courseResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('course'),
  displayMetadata: courseDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const equipmentResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('equipment'),
  displayMetadata: capabilityDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const facilityResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('facility'),
  displayMetadata: capabilityDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const extracurricularResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('extracurricular'),
  displayMetadata: emptyDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const projectResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('project'),
  displayMetadata: emptyDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const studentWorkResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('student_work'),
  displayMetadata: studentWorkDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const careerResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('career'),
  displayMetadata: emptyDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const supportResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('support'),
  displayMetadata: emptyDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const resultResourceSchema = z.discriminatedUnion('type', [
  courseResultResourceSchema,
  equipmentResultResourceSchema,
  facilityResultResourceSchema,
  extracurricularResultResourceSchema,
  projectResultResourceSchema,
  studentWorkResultResourceSchema,
  careerResultResourceSchema,
  supportResultResourceSchema,
])

export const resultResourcesSchema = z.object({
  course: z.array(courseResultResourceSchema).max(5),
  equipment: z.array(equipmentResultResourceSchema).max(4),
  facility: z.array(facilityResultResourceSchema).max(4),
  extracurricular: z.array(extracurricularResultResourceSchema).max(3),
  project: z.array(projectResultResourceSchema).max(3),
  student_work: z.array(studentWorkResultResourceSchema).max(3),
  career: z.array(careerResultResourceSchema).max(4),
  support: z.array(supportResultResourceSchema).max(3),
}).strict().superRefine((resources, context) => {
  if (resources.equipment.length + resources.facility.length > 4) {
    context.addIssue({
      code: 'too_big',
      maximum: 4,
      origin: 'array',
      inclusive: true,
      message: '장비와 시설 근거는 합쳐서 최대 4개입니다.',
      path: ['equipment'],
    })
  }

  const allResources = [
    ...resources.course,
    ...resources.equipment,
    ...resources.facility,
    ...resources.extracurricular,
    ...resources.project,
    ...resources.student_work,
    ...resources.career,
    ...resources.support,
  ]
  const ids = allResources.map(resource => resource.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: 'custom',
      message: '결과 자원 ID는 중복할 수 없습니다.',
    })
  }
})

const learningPathSchema = z.tuple([
  z.object({ year: z.literal(1), resources: z.array(courseResultResourceSchema).max(5) }).strict(),
  z.object({ year: z.literal(2), resources: z.array(courseResultResourceSchema).max(5) }).strict(),
  z.object({ year: z.literal(3), resources: z.array(courseResultResourceSchema).max(5) }).strict(),
  z.object({ year: z.literal(4), resources: z.array(courseResultResourceSchema).max(5) }).strict(),
])

const facultyPublicContactsSchema = z.object({
  office: boundedText(1, 200).optional(),
  phone: boundedText(1, 40).regex(/^[+0-9(). -]+$/u).optional(),
  email: z.email().max(254).optional(),
  website: publicHttpsUrlSchema.optional(),
}).strict()

const facultyResultBaseShape = {
  id: safeIdSchema,
  name: boundedText(1, 100),
  title: boundedText(1, 100),
  expertise: boundedText(1, 1000),
  reason: boundedText(1, 1000),
  publicContacts: facultyPublicContactsSchema,
}

export const facultyResultSchema = z.discriminatedUnion('role', [
  z.object({ ...facultyResultBaseShape, role: z.literal(facultyRoles[0]) }).strict(),
  z.object({ ...facultyResultBaseShape, role: z.literal(facultyRoles[1]) }).strict(),
  z.object({ ...facultyResultBaseShape, role: z.literal(facultyRoles[2]) }).strict(),
])

const primaryFacultySchema = z.object({
  ...facultyResultBaseShape,
  role: z.literal('primary'),
}).strict()

const backupFacultySchema = z.object({
  ...facultyResultBaseShape,
  role: z.literal('backup'),
}).strict()

const specialistFacultySchema = z.object({
  ...facultyResultBaseShape,
  role: z.literal('specialist'),
}).strict()

export const resultFacultySchema = z.object({
  primary: primaryFacultySchema,
  backup: backupFacultySchema,
  specialists: z.array(specialistFacultySchema).max(2),
}).strict().superRefine((faculty, context) => {
  const ids = [faculty.primary.id, faculty.backup.id, ...faculty.specialists.map(person => person.id)]
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: 'custom',
      message: '총괄·예비·전문 연계 교수 ID는 서로 달라야 합니다.',
    })
  }
})

export const resultSnapshotSchema = z.object({
  completedAt: z.iso.datetime({ offset: true }),
  selectedInterests: z.array(selectedInterestSchema).min(4).max(11),
  trackScores: trackScoresSchema,
  rankedTracks: z.tuple([
    z.enum(trackKeys),
    z.enum(trackKeys),
    z.enum(trackKeys),
    z.enum(trackKeys),
  ]),
  environmentScore: finiteScoreSchema,
  learningPath: learningPathSchema,
  resources: resultResourcesSchema,
  faculty: resultFacultySchema,
}).strict().superRefine((snapshot, context) => {
  const interestIds = snapshot.selectedInterests.map(interest => `${interest.group}:${interest.key}`)
  if (new Set(interestIds).size !== interestIds.length) {
    context.addIssue({
      code: 'custom',
      message: '선택 관심사는 중복할 수 없습니다.',
      path: ['selectedInterests'],
    })
  }

  const selectionLimits = { work: 4, result: 3, style: 2, career: 2 } as const
  for (const group of questionGroups) {
    const count = snapshot.selectedInterests.filter(interest => interest.group === group).length
    if (count < 1 || count > selectionLimits[group]) {
      context.addIssue({
        code: 'custom',
        message: `${group} 관심사는 1개 이상 ${selectionLimits[group]}개 이하여야 합니다.`,
        path: ['selectedInterests'],
      })
    }
  }

  if (new Set(snapshot.rankedTracks).size !== trackKeys.length) {
    context.addIssue({
      code: 'custom',
      message: '트랙 순위는 네 트랙을 한 번씩 포함해야 합니다.',
      path: ['rankedTracks'],
    })
  }

  const learningResources = snapshot.learningPath.flatMap(bucket => bucket.resources)
  const learningIds = learningResources.map(resource => resource.id)
  if (new Set(learningIds).size !== learningIds.length) {
    context.addIssue({
      code: 'custom',
      message: '학습경로 과정은 중복할 수 없습니다.',
      path: ['learningPath'],
    })
  }

  snapshot.learningPath.forEach((bucket, bucketIndex) => {
    bucket.resources.forEach((resource, resourceIndex) => {
      if (resource.displayMetadata.gradeYear !== bucket.year) {
        context.addIssue({
          code: 'custom',
          message: '교과 학년과 학습경로 학년이 일치해야 합니다.',
          path: ['learningPath', bucketIndex, 'resources', resourceIndex, 'displayMetadata', 'gradeYear'],
        })
      }
    })
  })

  const courseById = new Map(snapshot.resources.course.map(resource => [resource.id, resource]))
  if (learningResources.length !== snapshot.resources.course.length) {
    context.addIssue({
      code: 'custom',
      message: '학습경로는 선택된 모든 교과를 정확히 한 번 포함해야 합니다.',
      path: ['learningPath'],
    })
  }
  for (const resource of learningResources) {
    const courseResource = courseById.get(resource.id)
    if (courseResource === undefined || JSON.stringify(courseResource) !== JSON.stringify(resource)) {
      context.addIssue({
        code: 'custom',
        message: '학습경로 교과는 교과 결과 스냅샷과 동일해야 합니다.',
        path: ['learningPath'],
      })
      break
    }
  }
})

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

export const decodeResultSnapshot = (input: unknown): ResultSnapshot => {
  const result = resultSnapshotSchema.parse(input)
  return deepFreeze(result) as ResultSnapshot
}
