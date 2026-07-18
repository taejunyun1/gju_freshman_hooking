import { z } from 'zod'

import { careerNarrativeSchema } from './career-narrative'
import {
  facultyRoles,
  questionGroups,
  trackKeys,
} from '../types/domain'
import type { CareerNarrative } from '../types/career-narrative'
import { equipmentCategories } from '../types/result'
import type { ResultSnapshot, ResultSnapshotCore } from '../types/result'

export const resultSnapshotMaxBytes = 262_144

const hasOnlyPairedUtf16Surrogates = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (
        index + 1 >= value.length
        || nextCodeUnit < 0xDC00
        || nextCodeUnit > 0xDFFF
      ) {
        return false
      }
      index += 1
    }
    else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false
    }
  }
  return true
}

const hasNoC0OrC1Controls = (value: string) => [...value].every((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
})

const boundedText = (minimum: number, maximum: number) => z.string()
  .min(minimum)
  .max(maximum)
  .refine(value => value === value.trim(), '앞뒤 공백을 제거해 주세요.')
  .refine(hasOnlyPairedUtf16Surrogates, '짝이 맞지 않는 UTF-16 문자는 사용할 수 없습니다.')
  .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.')

const safeIdSchema = z.number().int().positive().safe()
const finiteScoreSchema = z.number().finite().min(0).max(100)
  .refine(value => Number.isInteger(value * 10), '점수는 소수점 첫째 자리까지만 허용됩니다.')
const tagKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)
const serializedUtf8ByteLength = (value: unknown) => {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string'
      ? new TextEncoder().encode(serialized).byteLength
      : null
  }
  catch {
    return null
  }
}
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
  credits: z.number().int().min(0).max(30),
}).strict()

const equipmentDisplayMetadataBaseShape = {
  locationLabel: boundedText(1, 120),
  confirmedQuantity: z.number().int().min(1).max(999),
  reservationUrl: z.literal('https://gjureserve.co.kr'),
  category: z.enum(equipmentCategories).optional(),
}

const equipmentDisplayMetadataSchema = z.discriminatedUnion('accessMode', [
  z.object({
    ...equipmentDisplayMetadataBaseShape,
    accessMode: z.literal('reservation'),
    accessLabel: z.literal('예약 가능'),
  }).strict(),
  z.object({
    ...equipmentDisplayMetadataBaseShape,
    accessMode: z.literal('inquiry'),
    accessLabel: z.literal('문의 전용'),
  }).strict(),
])

const facilityDisplayMetadataSchema = z.object({
  locationLabel: boundedText(1, 120),
  operationNote: boundedText(1, 1000),
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
  displayMetadata: equipmentDisplayMetadataSchema,
}).strict().superRefine(renderedReasonCheck)

export const facilityResultResourceSchema = z.object({
  ...resultResourceBaseShape,
  type: z.literal('facility'),
  displayMetadata: facilityDisplayMetadataSchema,
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

const resultSnapshotCoreObjectSchema = z.object({
  completedAt: z.iso.datetime({ offset: true }).max(32),
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
}).strict()

type ResultSnapshotSchemaInput = z.infer<typeof resultSnapshotCoreObjectSchema> & {
  readonly careerNarrative?: unknown
}

const refineResultSnapshot = (
  snapshot: ResultSnapshotSchemaInput,
  context: z.RefinementCtx,
) => {
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

  const selectedLabels = snapshot.selectedInterests.map(interest => interest.label)
  const canonicalResources = [
    ...snapshot.resources.course,
    ...snapshot.resources.equipment,
    ...snapshot.resources.facility,
    ...snapshot.resources.extracurricular,
    ...snapshot.resources.project,
    ...snapshot.resources.student_work,
    ...snapshot.resources.career,
    ...snapshot.resources.support,
  ]
  canonicalResources.forEach((resource) => {
    if (!selectedLabels.some(label => resource.connectionReason.includes(label))) {
      context.addIssue({
        code: 'custom',
        message: '연결 이유에는 선택한 관심사 문구가 정확히 포함되어야 합니다.',
        path: ['resources', resource.type, 'connectionReason'],
      })
    }
  })

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

  if (snapshot.careerNarrative !== undefined) {
    const narrative = snapshot.careerNarrative as CareerNarrative
    const sameEvidence = (actual: readonly string[], expected: readonly string[]) => (
      actual.length === expected.length
      && actual.every((value, index) => value === expected[index])
    )
    const topTrackRef = `track:${snapshot.rankedTracks[0]}`
    const secondTrackRef = `track:${snapshot.rankedTracks[1]}`
    const directionInterestRef = `interest:${snapshot.selectedInterests[0]!.key}`
    const learningInterest = snapshot.selectedInterests.find(interest => (
      interest.group === 'work' || interest.group === 'result'
    ))!
    const careerInterest = snapshot.selectedInterests.find(interest => interest.group === 'career')!
    const courseRefs = snapshot.resources.course.slice(0, 2).map(resource => `resource:${resource.id}`)
    const activity = snapshot.resources.project[0] ?? snapshot.resources.extracurricular[0]
    const activityRef = activity === undefined ? null : `resource:${activity.id}`
    const careerRef = snapshot.resources.career[0] === undefined
      ? null
      : `resource:${snapshot.resources.career[0].id}`
    const studentWorkRef = snapshot.resources.student_work[0] === undefined
      ? null
      : `resource:${snapshot.resources.student_work[0].id}`
    const primaryFacultyRefs = [
      `faculty:primary:${snapshot.faculty.primary.id}:name`,
      `faculty:primary:${snapshot.faculty.primary.id}:title`,
      `faculty:primary:${snapshot.faculty.primary.id}:expertise`,
    ]
    const firstSpecialist = snapshot.faculty.specialists[0]
    const specialistFacultyRefs = firstSpecialist === undefined
      ? []
      : [
          `faculty:specialist:${firstSpecialist.id}:name`,
          `faculty:specialist:${firstSpecialist.id}:title`,
          `faculty:specialist:${firstSpecialist.id}:expertise`,
        ]

    const directionEvidence = narrative.sentences[0].evidenceIds
    const directionValid = sameEvidence(directionEvidence, [directionInterestRef, topTrackRef])
      || sameEvidence(directionEvidence, [directionInterestRef, topTrackRef, secondTrackRef])

    const learningEvidence = narrative.sentences[1].evidenceIds
    const learningCourseValid = learningEvidence.length >= 1
      && learningEvidence.length <= 2
      && learningEvidence.every(ref => courseRefs.includes(ref))
    const learningCourseActivityValid = activityRef !== null
      && learningEvidence.length >= 2
      && learningEvidence.length <= 3
      && learningEvidence.at(-1) === activityRef
      && learningEvidence.slice(0, -1).every(ref => courseRefs.includes(ref))
    const learningFallbackValid = sameEvidence(learningEvidence, [
      `interest:${learningInterest.key}`,
      topTrackRef,
    ])

    const careerEvidence = narrative.sentences[2].evidenceIds
    const careerResourceValid = careerRef !== null && (
      sameEvidence(careerEvidence, [careerRef])
      || (studentWorkRef !== null && sameEvidence(careerEvidence, [careerRef, studentWorkRef]))
    )
    const careerFallbackValid = sameEvidence(careerEvidence, [
      `interest:${careerInterest.key}`,
      topTrackRef,
    ])

    const facultyEvidence = narrative.sentences[3].evidenceIds
    const facultyValid = sameEvidence(facultyEvidence, primaryFacultyRefs)
      || (specialistFacultyRefs.length === 3
        && sameEvidence(facultyEvidence, [...primaryFacultyRefs, ...specialistFacultyRefs]))

    const slotValidity = [
      directionValid,
      learningCourseValid || learningCourseActivityValid || learningFallbackValid,
      careerResourceValid || careerFallbackValid,
      facultyValid,
    ]
    slotValidity.forEach((valid, sentenceIndex) => {
      if (!valid) {
        context.addIssue({
          code: 'custom',
          message: '진로 제안 근거는 문장 슬롯의 승인 사실 구조와 정확히 일치해야 합니다.',
          path: ['careerNarrative', 'sentences', sentenceIndex, 'evidenceIds'],
        })
      }
    })
  }

  const snapshotBytes = serializedUtf8ByteLength(snapshot)
  if (snapshotBytes === null || snapshotBytes > resultSnapshotMaxBytes) {
    context.addIssue({
      code: 'custom',
      message: `결과 스냅샷은 UTF-8 ${resultSnapshotMaxBytes}바이트 이하여야 합니다.`,
    })
  }
}

export const legacyResultSnapshotSchema = resultSnapshotCoreObjectSchema
  .superRefine(refineResultSnapshot)

export const resultSnapshotSchema = resultSnapshotCoreObjectSchema.extend({
  careerNarrative: careerNarrativeSchema,
}).strict().superRefine(refineResultSnapshot)

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

export const decodeLegacyResultSnapshot = (input: unknown): ResultSnapshotCore => {
  const result = legacyResultSnapshotSchema.parse(input)
  return deepFreeze(result) as ResultSnapshotCore
}
