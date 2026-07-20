import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z, ZodError } from 'zod'

const SOURCE_DATE = '2026-07-14'
const RESERVATION_URL = 'https://gjureserve.co.kr'
const FACILITY_VERIFIED_AT = '2026-07-18T16:28:30+09:00'
const FACILITY_LOCATION_LABEL = '사진영상미디어학과'
const FACILITY_OPERATION_NOTE = '시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.'
const COMPUTER_LAB_OPERATION_NOTE = '2020년형 iMac 및 RTX 4080급 그래픽카드 탑재 워크스테이션이 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.'
const CONTENT_SQL_PATH = 'supabase/seed/content-2026.sql'
const EXPECTED_CONTENT_REVISION = 'sha256:11918b8b8bf1f687725d549f746780d1c91a792d274b269e18f3f2dff7ebc7ce'

const expectedCourseTitles = [
  '흑백사진과 암실', '사진영상학개론', '기초사진실기', '영상 에세이 메이킹',
  '영상 프레임과 컷', '라이팅과 스튜디오', '이미지와사회', '디지털 포토 에디팅',
  'AI와 이미지 메이킹', '디지털 이미지 제작과 프린트', '사진사', '영상드론기초',
  '내러티브 영상촬영', '응용 디지털 촬영', '사진커뮤니케이션',
  '영상 컬러와 포스트 프로덕션', '리서치와 레퍼런스 이미지 제작',
  '비주얼 스토리 메이킹', '다큐멘터리 메이킹&쇼케이스', '사진교과교육론',
  '사진교수학습방법', '커머셜 포토그라피 기초 워크숍', '포토 스토리 워크숍',
  '영상 인터뷰 내러티브 워크숍', '사물,데이터,이미지 워크숍',
  '커머셜 포토그라피 심화 워크숍', '포토에세이 워크숍',
  '영상 드론 콘텐츠 워크숍', '사진과 장소 그리고 콘텍스트 워크숍',
  '캡스톤 디자인1', '영상 콘텐츠 크리에이터 워크숍', '현장실습1', '현장실습2',
  '커머셜 포토그라피 세미나', '예술창작 프로젝트 세미나', '다큐멘터리 세미나',
  '캡스톤 디자인 2', '현장실습 4', '커머셜 포토그라피 랩',
  '예술창작 프로젝트 랩', '포스트 다큐멘터리 랩',
] as const

const expectedFacultyNames = [
  '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
  '정한결', '유별남', '김태현', '김명우',
] as const
const expectedFacilityKeys = ['studio_a_horizon', 'studio_b', 'darkroom', 'computer_lab'] as const
const expectedArchiveAlumniNames = [
  '서재훈', '김수성', '설소영', '김민범', '윤동규', '노하윤', '박지우', '박준희',
  '임승찬', '최관호', '김병준', '유성현', '정해찬', '김윤교', '박래현', '박진우', '유승현',
] as const
const expectedArchiveActivityKeys = [
  'content_one_campus_2019_2022',
  'regional_innovation_smart_drone_2020_2024',
  'interview_sound_workshop',
  'advertising_studio_visit',
  'summer_winter_field_practice',
  'jeju_tunnel_archive_project_lab',
  'gwangju_biennale_linked_exhibition_2023',
  'graduation_exhibition',
  'global_challenge_frame_in_52_2025',
  'underwater_drone_vr_jeju_2025',
] as const
const expectedArchiveFacilityKeys = ['studio_c_video', 'print_lab', 'portfolio_review_lab'] as const
const expectedFacultyRoles = [
  '조대연|full_time|primary', '윤태준|full_time|primary', '김사라|full_time|primary',
  '박재웅|adjunct|specialist', '정철호|adjunct|specialist', '곽동욱|adjunct|specialist',
  '정한결|practitioner|specialist', '유별남|practitioner|specialist',
  '김태현|practitioner|specialist', '김명우|practitioner|specialist',
] as const
const expectedSpecialistLinks = [
  '윤태준|박재웅|video', '윤태준|박재웅|drone', '윤태준|박재웅|vr', '윤태준|박재웅|video_360',
  '윤태준|정철호|exhibition', '윤태준|정철호|curating', '윤태준|정철호|art_theory',
  '|곽동욱|commercial', '|곽동욱|fashion', '|곽동욱|product', '|곽동욱|beauty',
  '|곽동욱|brand', '|곽동욱|studio', '|곽동욱|lighting',
  '윤태준|정한결|art_photo', '윤태준|정한결|ai', '윤태준|정한결|media_art', '윤태준|정한결|installation',
  '조대연|유별남|documentary', '김사라|유별남|documentary',
  '조대연|유별남|record', '조대연|유별남|photo_story',
  '조대연|김태현|documentary', '김사라|김태현|documentary',
  '윤태준|김태현|video', '윤태준|김태현|art_photo',
  '윤태준|김명우|ai', '윤태준|김명우|video', '윤태준|김명우|media_art', '윤태준|김명우|installation',
] as const
const expectedDuplicateCodes = new Set([
  'LEN-8LENS-01', 'DRN-DJI-01', 'DRN-DJI2-01', 'ETC-360-01', 'ETC-DJI-01',
])

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .sort()
      .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]))
  }
  return value
}

const tagKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)
const trackKeySchema = z.enum(['documentary', 'art_photo', 'commercial', 'video'])
const httpsUrlSchema = z.url().max(500).refine((value) => {
  try {
    return new URL(value).protocol === 'https:'
  }
  catch {
    return false
  }
}, 'source URL must use HTTPS')
const sourceDateSchema = z.literal(SOURCE_DATE)
const facultySourceDateSchema = z.enum([SOURCE_DATE, '2026-07-20'])
const draftSchema = z.literal('draft')

const curriculumRecordSchema = z.object({
  academicYear: z.literal(2026),
  grade: z.number().int().min(1).max(4),
  term: z.enum(['1학기', '2학기', '매학기', '방학중']),
  credits: z.number().int().min(1).max(30),
  title: z.string().trim().min(1).max(200),
  formerName: z.string().trim().min(1).max(200).nullable(),
  fusionMajor: z.string().trim().min(1).max(200).nullable(),
  sourceFormerLabel: z.literal('신규').optional(),
  sourceGoal: z.string().trim().min(1).max(4000),
  summary: z.string().trim().min(1).max(1000),
  tags: z.array(tagKeySchema).min(1),
  status: draftSchema,
  visibility: z.literal('public'),
  sourceDate: sourceDateSchema,
  sourceDocument: z.literal('2026학년도 개설 예정'),
}).strict()

const platformTagSchema = z.object({
  tagKey: tagKeySchema,
  tagLabel: z.string().trim().min(1).max(100),
}).strict()

const contactVisibilitySchema = z.object({
  office: z.enum(['admin_only', 'hidden']),
  phone: z.enum(['admin_only', 'hidden']),
  email: z.enum(['admin_only', 'hidden']),
  website: z.enum(['admin_only', 'hidden']),
}).strict()

const facultyRecordSchema = z.object({
  name: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(100),
  employmentType: z.enum(['full_time', 'adjunct', 'practitioner']),
  consultationRole: z.enum(['primary', 'specialist']),
  recommendationRole: z.string().trim().min(1).max(1000),
  office: z.string().trim().min(1).max(200).nullable(),
  phone: z.string().trim().min(1).max(40).nullable(),
  email: z.string().trim().email().max(254).nullable(),
  website: z.string().url().startsWith('https://').max(500).nullable(),
  contactVisibility: contactVisibilitySchema,
  expertiseSummary: z.string().trim().min(1).max(1000),
  profile: z.string().trim().min(1).max(8000),
  education: z.array(z.string().trim().min(1)),
  careers: z.array(z.string().trim().min(1)),
  teachingFields: z.array(z.string().trim().min(1)).min(1),
  studentProjects: z.array(z.string().trim().min(1)).min(1),
  careerPaths: z.array(z.string().trim().min(1)),
  institutionProjects: z.array(z.string().trim().min(1)),
  majorWorks: z.array(z.string().trim().min(1)).optional(),
  platformTags: z.array(platformTagSchema).min(1),
  status: draftSchema,
  weeklyCapacity: z.number().int().min(0).max(32767),
  priority: z.number().int().min(0).max(32767),
  sourceDate: facultySourceDateSchema,
  lastVerifiedAt: z.null(),
}).strict()

const specialistLinkSchema = z.object({
  primaryFacultyName: z.string().trim().min(1).nullable(),
  specialistFacultyName: z.string().trim().min(1),
  tagKey: tagKeySchema,
  tagLabel: z.string().trim().min(1).max(100),
  priority: z.literal(100),
  explanationTemplate: z.string().trim().min(1).max(1000),
}).strict()

const facultyInputSchema = z.object({
  faculty: z.array(facultyRecordSchema),
  specialistLinks: z.array(specialistLinkSchema),
}).strict()

const equipmentRecordSchema = z.object({
  sourceRow: z.number().int().min(1).max(144),
  name: z.string().trim().min(1).max(200),
  inventoryCode: z.string().trim().min(1).max(100),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']),
  category: z.enum(['body', 'lens', 'lighting', 'audio', 'drone', 'other']),
  accessMode: z.enum(['reservation', 'inquiry']),
  availabilityState: z.literal('available'),
  note: z.string().trim().min(1).max(1000).nullable(),
  dataQualityStatus: z.enum(['verified', 'duplicate_code', 'unidentified', 'quantity_check']),
  sourceDate: sourceDateSchema,
  tags: z.array(tagKeySchema).min(1),
}).strict()

const facilityRecordSchema = z.object({
  facilityKey: z.enum(expectedFacilityKeys),
  title: z.string().trim().min(1).max(200),
  facilityType: z.string().trim().min(1).max(100),
  coreActivity: z.string().trim().min(1).max(1000),
  tags: z.array(tagKeySchema).min(1),
  exampleCourses: z.array(z.string().trim().min(1)).min(1),
  operationNote: z.string().trim().min(1).max(1000),
  status: draftSchema,
  visibility: z.literal('public'),
  sourceDate: sourceDateSchema,
  lastVerifiedAt: z.literal(FACILITY_VERIFIED_AT),
}).strict()

const uniqueTrackEvidenceSchema = z.array(trackKeySchema).min(1).max(4)
  .refine(values => new Set(values).size === values.length)
const uniqueInterestEvidenceSchema = z.array(tagKeySchema).min(1).max(30)
  .refine(values => new Set(values).size === values.length)
const archiveEvidenceStatusSchema = z.enum(['historical', 'verify_required', 'recurring', 'snapshot'])
const archiveSourceShape = {
  sourceUrl: httpsUrlSchema,
  sourcePageTitle: z.string().trim().min(1).max(200),
  sourceLastEditedDate: z.iso.date(),
  evidenceStatus: archiveEvidenceStatusSchema,
  verificationNote: z.string().trim().min(1).max(1000),
}
const archiveResourceShape = {
  summary: z.string().trim().min(1).max(1000),
  connectionTemplate: z.string().trim().min(1).max(1000),
  trackEvidence: uniqueTrackEvidenceSchema,
  interestTags: uniqueInterestEvidenceSchema,
  status: draftSchema,
  visibility: z.enum(['public', 'admin_only']),
  priority: z.number().int().min(0).max(32767),
  sourceDate: z.iso.date(),
  ...archiveSourceShape,
}

const graduationYearCandidateSchema = z.object({
  year: z.number().int().min(1994).max(2100),
  sourceUrl: httpsUrlSchema,
}).strict()

const archiveAlumniRecordSchema = z.object({
  personKey: tagKeySchema,
  name: z.string().trim().min(1).max(100),
  graduationYear: z.number().int().min(1994).max(2100).nullable(),
  graduationYearStatus: z.enum(['confirmed', 'conflicted']),
  graduationYearCandidates: z.array(graduationYearCandidateSchema).max(2),
  roleAtSource: z.string().trim().min(1).max(200).nullable(),
  roleCandidates: z.array(z.string().trim().min(1).max(200)).max(2),
  roleStatus: z.enum(['title_confirmed', 'body_only', 'conflicted']),
  ...archiveResourceShape,
}).strict().superRefine((person, context) => {
  const graduationConfirmed = person.graduationYearStatus === 'confirmed'
    && person.graduationYear !== null
    && person.graduationYearCandidates.length === 0
  const graduationConflicted = person.graduationYearStatus === 'conflicted'
    && person.graduationYear === null
    && person.graduationYearCandidates.length === 2
    && new Set(person.graduationYearCandidates.map(candidate => candidate.year)).size === 2
  if (!graduationConfirmed && !graduationConflicted) {
    context.addIssue({ code: 'custom', path: ['graduationYearStatus'], message: 'invalid graduation year evidence state' })
  }
  const roleConfirmed = person.roleStatus !== 'conflicted'
    && person.roleAtSource !== null
    && person.roleCandidates.length === 0
  const roleConflicted = person.roleStatus === 'conflicted'
    && person.roleAtSource === null
    && person.roleCandidates.length === 2
    && new Set(person.roleCandidates).size === 2
  if (!roleConfirmed && !roleConflicted) {
    context.addIssue({ code: 'custom', path: ['roleStatus'], message: 'invalid role evidence state' })
  }
  if ((person.graduationYearStatus === 'conflicted' || person.roleStatus === 'conflicted')
    && (person.visibility !== 'admin_only' || person.evidenceStatus !== 'verify_required')) {
    context.addIssue({ code: 'custom', path: ['visibility'], message: 'conflicted alumni evidence must remain admin only' })
  }
})

const archiveActivityRecordSchema = z.object({
  activityKey: tagKeySchema,
  resourceType: z.enum(['extracurricular', 'project']),
  title: z.string().trim().min(1).max(200),
  periodLabel: z.string().trim().min(1).max(100).nullable(),
  ...archiveResourceShape,
}).strict().superRefine((activity, context) => {
  if (activity.evidenceStatus === 'historical' && !activity.summary.includes('과거 운영 사례')) {
    context.addIssue({ code: 'custom', path: ['summary'], message: 'historical summary must state that it is a past operating example' })
  }
})

const archiveFacilityRecordSchema = z.object({
  facilityKey: z.enum(expectedArchiveFacilityKeys),
  title: z.string().trim().min(1).max(200),
  facilityType: z.string().trim().min(1).max(100),
  coreActivity: z.string().trim().min(1).max(1000),
  trackEvidence: uniqueTrackEvidenceSchema,
  interestTags: uniqueInterestEvidenceSchema,
  exampleCourses: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  operationNote: z.null(),
  status: draftSchema,
  visibility: z.literal('public'),
  sourceDate: z.iso.date(),
  lastVerifiedAt: z.null(),
  ...archiveSourceShape,
}).strict().refine(facility => facility.evidenceStatus === 'verify_required', {
  path: ['evidenceStatus'], message: 'archive facilities require verification',
})

const departmentArchiveInputSchema = z.object({
  alumni: z.array(archiveAlumniRecordSchema),
  activities: z.array(archiveActivityRecordSchema),
  facilities: z.array(archiveFacilityRecordSchema),
}).strict()

export interface RawContentSeedInputs {
  curriculum: unknown
  faculty: unknown
  equipment: unknown
  facilities: unknown
  departmentArchive: unknown
}

type CurriculumSource = z.infer<typeof curriculumRecordSchema>
type FacultySource = z.infer<typeof facultyRecordSchema>
type EquipmentSource = z.infer<typeof equipmentRecordSchema>
type FacilitySource = z.infer<typeof facilityRecordSchema>
type SpecialistLinkSource = z.infer<typeof specialistLinkSchema>
type ArchiveAlumniSource = z.infer<typeof archiveAlumniRecordSchema>
type ArchiveActivitySource = z.infer<typeof archiveActivityRecordSchema>
type ArchiveFacilitySource = z.infer<typeof archiveFacilityRecordSchema>

interface DepartmentArchiveSource {
  alumni: ArchiveAlumniSource[]
  activities: ArchiveActivitySource[]
  facilities: ArchiveFacilitySource[]
}

export interface ParsedCurriculum extends CurriculumSource {
  gradeYear: number
}

export interface ParsedContentSeedInputs {
  curriculum: ParsedCurriculum[]
  faculty: FacultySource[]
  specialistLinks: SpecialistLinkSource[]
  equipment: EquipmentSource[]
  facilities: FacilitySource[]
  departmentArchive: DepartmentArchiveSource
}

export interface DerivedResource {
  seedKey: string
  type: 'course' | 'equipment' | 'facility' | 'extracurricular' | 'project' | 'career'
  title: string
  summary: string
  connectionTemplate: string
  status: 'draft'
  visibility: 'public' | 'admin_only'
  priority: number
  sourceDate: string
  metadata: Record<string, unknown>
}

export interface DerivedResourceTag {
  resourceSeedKey: string
  tagKey: string
  weight: number
  isPrimary: boolean
}

export interface DerivedFacultyTag {
  facultyName: string
  tagKey: string
  tagLabel: string
  category: 'track' | 'activity' | 'result' | 'career' | 'specialist'
  weight: number
  isPrimary: boolean
  source: 'platform' | 'teaching' | 'project' | 'career'
}

export interface DerivedContentSeed {
  resources: DerivedResource[]
  resourceTags: DerivedResourceTag[]
  equipmentInventory: Array<EquipmentSource & { resourceSeedKey: string }>
  faculty: FacultySource[]
  facultyTags: DerivedFacultyTag[]
  specialistLinks: SpecialistLinkSource[]
}

export const createContentRevision = (parsed: ParsedContentSeedInputs) => `sha256:${createHash('sha256')
  .update(JSON.stringify(canonicalize(parsed)))
  .digest('hex')}`

const formatZodError = (section: string, error: ZodError) => {
  const unknown = error.issues.some(issue => issue.code === 'unrecognized_keys')
  return `${section} seed is invalid${unknown ? ' (unknown field)' : ''}`
}

const parseSection = <T>(section: string, schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value)
  }
  catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(section, error), { cause: error })
    }
    throw error
  }
}

const assertExactOrder = (section: string, actual: string[], expected: readonly string[]) => {
  if (actual.length !== expected.length) {
    throw new Error(`${section} seed must contain exactly ${expected.length} records`)
  }
  if (actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${section} seed order or identity differs from the approved manifest`)
  }
  if (new Set(actual).size !== actual.length) {
    throw new Error(`${section} seed contains a duplicate identity`)
  }
}

const countBy = <T>(values: T[], key: (value: T) => string) => values.reduce<Record<string, number>>(
  (counts, value) => ({ ...counts, [key(value)]: (counts[key(value)] ?? 0) + 1 }),
  {},
)

export const parseContentSeedInputs = (input: RawContentSeedInputs): ParsedContentSeedInputs => {
  const curriculumSource = parseSection(
    'curriculum', curriculumRecordSchema.array(), input.curriculum,
  )
  if (curriculumSource.length !== 41) {
    throw new Error('curriculum seed must contain exactly 41 records')
  }
  assertExactOrder('curriculum', curriculumSource.map(course => course.title), expectedCourseTitles)
  const curriculum = curriculumSource.map(course => ({ ...course, gradeYear: course.grade }))

  const facultyInput = parseSection('faculty', facultyInputSchema, input.faculty)
  assertExactOrder('faculty', facultyInput.faculty.map(person => person.name), expectedFacultyNames)
  const facultyRoles = facultyInput.faculty.map(person => (
    `${person.name}|${person.employmentType}|${person.consultationRole}`
  ))
  if (facultyRoles.some((role, index) => role !== expectedFacultyRoles[index])) {
    throw new Error('faculty role manifest differs from the approved guide')
  }
  if (facultyInput.specialistLinks.length !== 30) {
    throw new Error('faculty link seed must contain exactly 30 records')
  }
  const facultyNames = new Set(facultyInput.faculty.map(person => person.name))
  for (const link of facultyInput.specialistLinks) {
    if ((link.primaryFacultyName !== null && !facultyNames.has(link.primaryFacultyName))
      || !facultyNames.has(link.specialistFacultyName)) {
      throw new Error('faculty link references an unknown faculty profile')
    }
  }
  const specialistLinks = facultyInput.specialistLinks.map(link => (
    `${link.primaryFacultyName ?? ''}|${link.specialistFacultyName}|${link.tagKey}`
  ))
  if (specialistLinks.some((link, index) => link !== expectedSpecialistLinks[index])) {
    throw new Error('faculty link manifest differs from the approved guide')
  }

  const equipment = parseSection('equipment', equipmentRecordSchema.array(), input.equipment)
  if (equipment.length !== 144) {
    throw new Error('equipment seed must contain exactly 144 records')
  }
  if (equipment.some((item, index) => item.sourceRow !== index + 1)) {
    throw new Error('equipment source row order differs from the approved manifest')
  }
  const equipmentCounts = countBy(equipment, item => item.dataQualityStatus)
  if (equipmentCounts.verified !== 128 || equipmentCounts.duplicate_code !== 10
    || equipmentCounts.unidentified !== 2 || equipmentCounts.quantity_check !== 4) {
    throw new Error('equipment data quality count differs from the approved manifest')
  }
  const equipmentLocationCounts = countBy(equipment, item => item.locationKey)
  if (equipmentLocationCounts.department_equipment_room !== 83
    || equipmentLocationCounts.fantasy_lab !== 61) {
    throw new Error('equipment location count differs from the approved manifest')
  }
  const equipmentAccessCounts = countBy(equipment, item => item.accessMode)
  if (equipmentAccessCounts.reservation !== 81 || equipmentAccessCounts.inquiry !== 63) {
    throw new Error('equipment access mode count differs from the approved manifest')
  }
  const equipmentCategoryCounts = countBy(equipment, item => item.category)
  const expectedCategoryCounts = { body: 24, lens: 34, lighting: 30, audio: 25, drone: 8, other: 23 }
  if (Object.entries(expectedCategoryCounts)
    .some(([category, count]) => equipmentCategoryCounts[category] !== count)) {
    throw new Error('equipment category count differs from the approved manifest')
  }
  for (const code of expectedDuplicateCodes) {
    const rows = equipment.filter(item => item.inventoryCode === code)
    if (rows.length !== 2 || rows.some(item => item.dataQualityStatus !== 'duplicate_code')) {
      throw new Error('equipment duplicate code manifest is invalid')
    }
  }

  const facilities = parseSection('facilities', facilityRecordSchema.array(), input.facilities)
  assertExactOrder('facilities', facilities.map(facility => facility.facilityKey), expectedFacilityKeys)
  if (facilities.some(facility => facility.operationNote !== (
    facility.facilityKey === 'computer_lab'
      ? COMPUTER_LAB_OPERATION_NOTE
      : FACILITY_OPERATION_NOTE
  ))) {
    throw new Error('facility operation notes differ from the verified manifest')
  }
  const courseTitles = new Set(curriculum.map(course => course.title))
  if (facilities.some(facility => facility.exampleCourses.some(title => !courseTitles.has(title)))) {
    throw new Error('facilities seed contains a broken course reference')
  }

  const departmentArchive = parseSection(
    'department archive', departmentArchiveInputSchema, input.departmentArchive,
  )
  assertExactOrder(
    'department archive alumni',
    departmentArchive.alumni.map(person => person.name),
    expectedArchiveAlumniNames,
  )
  assertExactOrder(
    'department archive activities',
    departmentArchive.activities.map(activity => activity.activityKey),
    expectedArchiveActivityKeys,
  )
  assertExactOrder(
    'department archive facilities',
    departmentArchive.facilities.map(facility => facility.facilityKey),
    expectedArchiveFacilityKeys,
  )
  if (departmentArchive.activities.filter(activity => activity.resourceType === 'extracurricular').length !== 5
    || departmentArchive.activities.filter(activity => activity.resourceType === 'project').length !== 5) {
    throw new Error('department archive activity type count differs from the approved manifest')
  }
  if (departmentArchive.facilities.some(facility => (
    facility.exampleCourses.some(title => !courseTitles.has(title))
  ))) {
    throw new Error('department archive facilities contain a broken canonical course reference')
  }
  const archiveRecords = [
    ...departmentArchive.alumni,
    ...departmentArchive.activities,
    ...departmentArchive.facilities,
  ]
  if (archiveRecords.some(record => record.sourceDate !== record.sourceLastEditedDate)) {
    throw new Error('department archive source dates must preserve the audited last-edited date')
  }
  if (/동아리|학생회|학생자치/u.test(JSON.stringify(departmentArchive))) {
    throw new Error('department archive seed must not invent club or student-government records')
  }

  const parsed = {
    curriculum,
    faculty: facultyInput.faculty,
    specialistLinks: facultyInput.specialistLinks,
    equipment,
    facilities,
    departmentArchive,
  }
  const contentRevision = createContentRevision(parsed)
  if (contentRevision !== EXPECTED_CONTENT_REVISION) {
    throw new Error(`content seed manifest differs from the approved internal sources: ${contentRevision}`)
  }
  return parsed
}

const courseSeedKey = (title: string) => `course:${title}`
const equipmentSeedKey = (locationKey: string, name: string) => `equipment:${locationKey}:${name}`
const facilitySeedKey = (facilityKey: string) => `facility:${facilityKey}`

const locationLabel = (key: EquipmentSource['locationKey']) => key === 'department_equipment_room'
  ? '사진영상미디어학과 기자재실'
  : '판타지랩'

const unique = <T>(values: T[]) => [...new Set(values)]

const archiveMetadata = (source: {
  sourceUrl: string
  sourcePageTitle: string
  sourceLastEditedDate: string
  evidenceStatus: 'historical' | 'verify_required' | 'recurring' | 'snapshot'
  trackEvidence: Array<'documentary' | 'art_photo' | 'commercial' | 'video'>
  interestTags: string[]
  verificationNote: string
}) => ({
  sourceUrl: source.sourceUrl,
  sourcePageTitle: source.sourcePageTitle,
  sourceLastEditedDate: source.sourceLastEditedDate,
  evidenceStatus: source.evidenceStatus,
  trackEvidence: source.trackEvidence,
  interestEvidence: source.interestTags,
  verificationNote: source.verificationNote,
})

const pushArchiveResourceTags = (
  target: DerivedResourceTag[],
  resourceSeedKey: string,
  trackEvidence: string[],
  interestTags: string[],
) => {
  unique([...trackEvidence, ...interestTags]).forEach((tagKey, index) => target.push({
    resourceSeedKey,
    tagKey,
    weight: index === 0 ? 3 : 2,
    isPrimary: index === 0,
  }))
}

const semanticTagRules: Array<[RegExp, string]> = [
  [/광고|커머셜/u, 'commercial'], [/패션/u, 'fashion'], [/제품/u, 'product'],
  [/뷰티/u, 'beauty'], [/브랜드/u, 'brand'], [/스튜디오/u, 'studio'], [/조명/u, 'lighting'],
  [/드론/u, 'drone'], [/360/u, 'video_360'], [/VR/u, 'vr'], [/영상/u, 'video'],
  [/내러티브/u, 'narrative'], [/프레임|컷/u, 'framing'], [/융합/u, 'convergence'],
  [/인터뷰|구술/u, 'interview'], [/다큐멘터리/u, 'documentary'], [/지역/u, 'local'],
  [/아카이브/u, 'archive'], [/공공/u, 'public_content'], [/문화기관/u, 'cultural_institution'],
  [/문화유산/u, 'cultural_heritage'], [/현장/u, 'field'], [/포토스토리/u, 'photo_story'],
  [/포토에세이/u, 'photo_essay'], [/포토북|사진집/u, 'photobook'], [/포트폴리오/u, 'portfolio'],
  [/전시/u, 'exhibition'], [/큐레이팅/u, 'curating'], [/예술이론|사진이론/u, 'art_theory'],
  [/미디어아트/u, 'media_art'], [/설치/u, 'installation'], [/AI/u, 'ai'],
  [/포토커뮤니케이션/u, 'photo_communication'], [/시각커뮤니케이션/u, 'visual_communication'],
  [/사진작가/u, 'photographer'], [/영상작가/u, 'video_artist'], [/기획/u, 'planning'],
  [/기록/u, 'record'], [/사진/u, 'photography'],
]

const semanticTagKeys = (label: string, prefix: string) => {
  const matched = unique(semanticTagRules
    .filter(([pattern]) => pattern.test(label))
    .map(([, tagKey]) => tagKey))
  if (matched.length > 0) return matched
  let hash = 2166136261
  for (const character of label) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return [`${prefix}_${(hash >>> 0).toString(16)}`]
}

const pushFacultyTag = (
  target: DerivedFacultyTag[],
  tag: DerivedFacultyTag,
) => {
  if (!target.some(existing => existing.facultyName === tag.facultyName
    && existing.tagKey === tag.tagKey && existing.category === tag.category)) {
    target.push(tag)
  }
}

const resultPlatformTagKeys = new Set([
  'photo_story', 'public_content', 'exhibition', 'media_art', 'photobook', 'portfolio', 'archive',
])
const activityPlatformTagKeys = new Set([
  'record', 'social', 'local', 'photo_communication', 'visual_communication', 'narrative',
  'interview', 'installation', 'ai', 'personal_project', 'local_record', 'public_institution',
  'cultural_institution', 'field_research', 'cultural_heritage', 'institution_collaboration',
])

const platformCategory = (person: FacultySource, tagKey: string): DerivedFacultyTag['category'] => {
  if (person.consultationRole === 'specialist') return 'specialist'
  if (resultPlatformTagKeys.has(tagKey)) return 'result'
  if (activityPlatformTagKeys.has(tagKey)) return 'activity'
  return 'track'
}

export const deriveContentSeed = (parsed: ParsedContentSeedInputs): DerivedContentSeed => {
  const resources: DerivedResource[] = []
  const resourceTags: DerivedResourceTag[] = []

  for (const course of parsed.curriculum) {
    const seedKey = courseSeedKey(course.title)
    resources.push({
      seedKey,
      type: 'course',
      title: course.title,
      summary: course.summary,
      connectionTemplate: '선택한 ‘{interest}’ 관심이 {goalSummary} ‘{title}’과 연결됩니다.',
      status: 'draft',
      visibility: course.visibility,
      priority: 0,
      sourceDate: course.sourceDate,
      metadata: {
        seedKey,
        academic_year: course.academicYear,
        grade_year: course.gradeYear,
        term: course.term,
        credits: course.credits,
        former_name: course.formerName,
        source_former_label: course.sourceFormerLabel ?? null,
        fusion_major: course.fusionMajor,
        source_goal: course.sourceGoal,
        source_document: course.sourceDocument,
      },
    })
    unique(course.tags).forEach((tagKey, index) => resourceTags.push({
      resourceSeedKey: seedKey,
      tagKey,
      weight: index === 0 ? 3 : 2,
      isPrimary: index === 0,
    }))
  }

  const equipmentGroups = new Map<string, EquipmentSource[]>()
  for (const item of parsed.equipment) {
    const key = equipmentSeedKey(item.locationKey, item.name)
    equipmentGroups.set(key, [...(equipmentGroups.get(key) ?? []), item])
  }
  for (const [seedKey, items] of equipmentGroups) {
    const first = items[0]!
    const verifiedItems = items.filter(item => item.dataQualityStatus === 'verified')
    const isPublic = verifiedItems.length > 0
    const accessModes = unique(items.map(item => item.accessMode))
    if (accessModes.length !== 1) {
      throw new Error(`equipment group has conflicting access modes: ${first.name}`)
    }
    const accessMode = accessModes[0]!
    resources.push({
      seedKey,
      type: 'equipment',
      title: first.name,
      summary: isPublic
        ? `${locationLabel(first.locationKey)}에서 확인된 제작 기반 기자재입니다. 기준일 이후 실제 이용 가능 여부는 예약 시스템 또는 학과에 확인해야 합니다.`
        : `${locationLabel(first.locationKey)}의 검수 전 기자재입니다. 모델·코드·수량 확인이 필요합니다.`,
      connectionTemplate: '선택한 ‘{interest}’ 관심과 관련된 교과·프로젝트 제작을 뒷받침하는 ‘{title}’ 기자재입니다.',
      status: 'draft',
      visibility: isPublic ? 'public' : 'admin_only',
      priority: 0,
      sourceDate: first.sourceDate,
      metadata: {
        seedKey,
        category: first.category,
        locationKey: first.locationKey,
        locationLabel: locationLabel(first.locationKey),
        accessMode,
        accessLabel: accessMode === 'reservation' ? '예약 가능' : '문의 전용',
        confirmedQuantity: verifiedItems.length,
        reservationUrl: RESERVATION_URL,
        snapshotNotice: '2026-07-14 운영 데이터이며 현재 이용 가능 여부를 보장하지 않습니다.',
        supportingEvidence: true,
      },
    })
    unique(items.flatMap(item => item.tags)).forEach((tagKey, index) => resourceTags.push({
      resourceSeedKey: seedKey,
      tagKey,
      weight: index === 0 ? 3 : 2,
      isPrimary: index === 0,
    }))
  }

  for (const facility of parsed.facilities) {
    const seedKey = facilitySeedKey(facility.facilityKey)
    resources.push({
      seedKey,
      type: 'facility',
      title: facility.title,
      summary: facility.coreActivity,
      connectionTemplate: '선택한 ‘{interest}’ 관심과 관련된 교과·프로젝트 제작을 뒷받침하는 ‘{title}’ 시설입니다.',
      status: 'draft',
      visibility: facility.visibility,
      priority: 0,
      sourceDate: facility.sourceDate,
      metadata: {
        seedKey,
        facilityKey: facility.facilityKey,
        facilityType: facility.facilityType,
        location_label: FACILITY_LOCATION_LABEL,
        activities: [facility.coreActivity],
        exampleCourses: facility.exampleCourses,
        operationNote: facility.operationNote,
        lastVerifiedAt: facility.lastVerifiedAt,
        supportingEvidence: true,
      },
    })
    unique(facility.tags).forEach((tagKey, index) => resourceTags.push({
      resourceSeedKey: seedKey,
      tagKey,
      weight: index === 0 ? 3 : 2,
      isPrimary: index === 0,
    }))
  }

  for (const person of parsed.departmentArchive.alumni) {
    const seedKey = `archive:career:${person.personKey}`
    resources.push({
      seedKey,
      type: 'career',
      title: `졸업생 진로 사례 · ${person.name}`,
      summary: person.summary,
      connectionTemplate: person.connectionTemplate,
      status: person.status,
      visibility: person.visibility,
      priority: person.priority,
      sourceDate: person.sourceDate,
      metadata: {
        seedKey,
        archive: archiveMetadata(person),
        publicName: person.name,
        graduationYear: person.graduationYear,
        graduationYearStatus: person.graduationYearStatus,
        graduationYearCandidates: person.graduationYearCandidates,
        roleAtSource: person.roleAtSource,
        roleCandidates: person.roleCandidates,
        roleStatus: person.roleStatus,
      },
    })
    pushArchiveResourceTags(resourceTags, seedKey, person.trackEvidence, person.interestTags)
  }

  for (const activity of parsed.departmentArchive.activities) {
    const seedKey = `archive:${activity.resourceType}:${activity.activityKey}`
    resources.push({
      seedKey,
      type: activity.resourceType,
      title: activity.title,
      summary: activity.summary,
      connectionTemplate: activity.connectionTemplate,
      status: activity.status,
      visibility: activity.visibility,
      priority: activity.priority,
      sourceDate: activity.sourceDate,
      metadata: {
        seedKey,
        archive: archiveMetadata(activity),
        periodLabel: activity.periodLabel,
      },
    })
    pushArchiveResourceTags(resourceTags, seedKey, activity.trackEvidence, activity.interestTags)
  }

  for (const facility of parsed.departmentArchive.facilities) {
    const seedKey = `archive:facility:${facility.facilityKey}`
    resources.push({
      seedKey,
      type: 'facility',
      title: facility.title,
      summary: facility.coreActivity,
      connectionTemplate: '선택한 ‘{interest}’ 관심과 관련된 교과·프로젝트 제작을 뒷받침하는 검증 전 시설 후보 ‘{title}’입니다.',
      status: facility.status,
      visibility: facility.visibility,
      priority: 0,
      sourceDate: facility.sourceDate,
      metadata: {
        seedKey,
        facilityKey: facility.facilityKey,
        facilityType: facility.facilityType,
        activities: [facility.coreActivity],
        exampleCourses: facility.exampleCourses,
        operation_note: facility.operationNote,
        last_verified_at: facility.lastVerifiedAt,
        supportingEvidence: true,
        archive: archiveMetadata(facility),
      },
    })
    pushArchiveResourceTags(resourceTags, seedKey, facility.trackEvidence, facility.interestTags)
  }

  const facultyTags: DerivedFacultyTag[] = []
  for (const person of parsed.faculty) {
    for (const tag of person.platformTags) {
      pushFacultyTag(facultyTags, {
        facultyName: person.name,
        tagKey: tag.tagKey,
        tagLabel: tag.tagLabel,
        category: platformCategory(person, tag.tagKey),
        weight: 3,
        isPrimary: true,
        source: 'platform',
      })
    }
    const contextualTags: Array<{
      labels: string[]
      category: DerivedFacultyTag['category']
      weight: number
      source: DerivedFacultyTag['source']
      prefix: string
    }> = [
      { labels: person.teachingFields, category: 'activity', weight: 2, source: 'teaching', prefix: 'activity' },
      { labels: person.studentProjects, category: 'result', weight: 2, source: 'project', prefix: 'result' },
      { labels: person.careerPaths, category: 'career', weight: 3, source: 'career', prefix: 'career' },
    ]
    for (const context of contextualTags) {
      for (const label of context.labels) {
        for (const tagKey of semanticTagKeys(label, context.prefix)) {
          pushFacultyTag(facultyTags, {
            facultyName: person.name,
            tagKey,
            tagLabel: label,
            category: context.category,
            weight: context.weight,
            isPrimary: false,
            source: context.source,
          })
        }
      }
    }
  }

  const equipmentInventory = parsed.equipment.map(item => ({
    ...item,
    resourceSeedKey: equipmentSeedKey(item.locationKey, item.name),
  }))

  return {
    resources,
    resourceTags,
    equipmentInventory,
    faculty: parsed.faculty,
    facultyTags,
    specialistLinks: parsed.specialistLinks,
  }
}

export const summarizeContentSeed = (seed: DerivedContentSeed) => ({
  courses: seed.resources.filter(resource => resource.type === 'course').length,
  equipmentItems: seed.equipmentInventory.length,
  facilities: seed.resources.filter(resource => resource.type === 'facility').length,
  extracurricular: seed.resources.filter(resource => resource.type === 'extracurricular').length,
  projects: seed.resources.filter(resource => resource.type === 'project').length,
  careers: seed.resources.filter(resource => resource.type === 'career').length,
  faculty: seed.faculty.length,
  verifiedEquipmentItems: seed.equipmentInventory
    .filter(item => item.dataQualityStatus === 'verified').length,
  resources: seed.resources.length,
  equipmentGroups: seed.resources.filter(resource => resource.type === 'equipment').length,
  publicEquipmentGroups: seed.resources
    .filter(resource => resource.type === 'equipment' && resource.visibility === 'public').length,
  adminOnlyEquipmentGroups: seed.resources
    .filter(resource => resource.type === 'equipment' && resource.visibility === 'admin_only').length,
  specialistLinks: seed.specialistLinks.length,
})

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`
const sqlJson = (value: unknown) => `${sqlString(JSON.stringify(value))}::jsonb`

export const generateContentSeedSql = (parsed: ParsedContentSeedInputs) => {
  const seed = deriveContentSeed(parsed)
  const revision = createContentRevision(parsed)
  const resourceManifest = seed.resources.map(resource => ({
    seed_key: resource.seedKey,
    type: resource.type,
    title: resource.title,
    summary: resource.summary,
    connection_template: resource.connectionTemplate,
    status: resource.status,
    visibility: resource.visibility,
    priority: resource.priority,
    source_date: resource.sourceDate,
    metadata: resource.metadata,
  }))
  const resourceTagManifest = seed.resourceTags.map(tag => ({
    resource_seed_key: tag.resourceSeedKey,
    tag_key: tag.tagKey,
    weight: tag.weight,
    is_primary: tag.isPrimary,
  }))
  const inventoryManifest = seed.equipmentInventory.map(item => ({
    resource_seed_key: item.resourceSeedKey,
    inventory_code: item.inventoryCode,
    source_row: item.sourceRow,
    location_key: item.locationKey,
    access_mode: item.accessMode,
    availability_state: item.availabilityState,
    note: item.note,
    data_quality_status: item.dataQualityStatus,
    source_date: item.sourceDate,
  }))
  const facultyManifest = seed.faculty.map(person => ({
    name: person.name,
    title: person.title,
    employment_type: person.employmentType,
    consultation_role: person.consultationRole,
    office: person.office,
    phone: person.phone,
    email: person.email,
    website: person.website,
    contact_visibility: person.contactVisibility,
    expertise_summary: person.expertiseSummary,
    bio: person.profile,
    profile_sections: {
      recommendationRole: person.recommendationRole,
      education: person.education,
      careers: person.careers,
      teachingFields: person.teachingFields,
      studentProjects: person.studentProjects,
      careerPaths: person.careerPaths,
      institutionProjects: person.institutionProjects,
      majorWorks: person.majorWorks ?? [],
    },
    status: person.status,
    weekly_capacity: person.weeklyCapacity,
    priority: person.priority,
    source_date: person.sourceDate,
  }))
  const facultyTagManifest = seed.facultyTags.map(tag => ({
    faculty_name: tag.facultyName,
    tag_key: tag.tagKey,
    tag_label: tag.tagLabel,
    category: tag.category,
    weight: tag.weight,
    is_primary: tag.isPrimary,
  }))
  const specialistLinkManifest = seed.specialistLinks.map(link => ({
    primary_faculty_name: link.primaryFacultyName,
    specialist_faculty_name: link.specialistFacultyName,
    tag_key: link.tagKey,
    priority: link.priority,
    explanation_template: link.explanationTemplate,
  }))

  return `-- Generated by scripts/seed-content.ts. Do not edit.
-- Content revision: ${revision}
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('photo_next.content_2026.v1', 0)
);

lock table public.resources, public.resource_tags, public.equipment_inventory_items,
  public.faculty, public.faculty_tags, public.faculty_specialist_links
  in share row exclusive mode;

do $seed_guard$
begin
  if exists (
      select 1 from public.resources resource
      where coalesce(resource.metadata ->> 'seedKey', '') not like 'project_catalog:%'
    )
    or exists (
      select 1
      from public.resource_tags tag
      join public.resources resource on resource.id = tag.resource_id
      where coalesce(resource.metadata ->> 'seedKey', '') not like 'project_catalog:%'
    )
    or exists (select 1 from public.equipment_inventory_items)
    or exists (select 1 from public.faculty)
    or exists (select 1 from public.faculty_tags)
    or exists (select 1 from public.faculty_specialist_links)
  then
    raise exception using
      errcode = 'P0001',
      message = 'content seed target tables are not empty';
  end if;
end
$seed_guard$;

insert into public.resources (
  type, title, summary, connection_template, status, visibility, priority, source_date, metadata
)
select type, title, summary, connection_template, status, visibility, priority, source_date, metadata
from pg_catalog.jsonb_to_recordset(${sqlJson(resourceManifest)}) as seed (
  seed_key text, type text, title text, summary text, connection_template text,
  status text, visibility text, priority smallint, source_date date, metadata jsonb
);

insert into public.resource_tags (resource_id, tag_key, weight, is_primary)
select resource.id, seed.tag_key, seed.weight, seed.is_primary
from pg_catalog.jsonb_to_recordset(${sqlJson(resourceTagManifest)}) as seed (
  resource_seed_key text, tag_key text, weight smallint, is_primary boolean
)
join public.resources as resource
  on resource.metadata ->> 'seedKey' = seed.resource_seed_key;

insert into public.equipment_inventory_items (
  equipment_resource_id, inventory_code, source_row, location_key, access_mode,
  availability_state, note, data_quality_status, source_date
)
select resource.id, seed.inventory_code, seed.source_row, seed.location_key, seed.access_mode,
  seed.availability_state, seed.note, seed.data_quality_status, seed.source_date
from pg_catalog.jsonb_to_recordset(${sqlJson(inventoryManifest)}) as seed (
  resource_seed_key text, inventory_code text, source_row integer, location_key text,
  access_mode text, availability_state text, note text, data_quality_status text, source_date date
)
join public.resources as resource
  on resource.metadata ->> 'seedKey' = seed.resource_seed_key;

insert into public.faculty (
  name, title, employment_type, consultation_role, office, phone, email, website,
  contact_visibility, expertise_summary, bio, profile_sections, status,
  weekly_capacity, priority, source_date
)
select name, title, employment_type, consultation_role, office, phone, email, website,
  contact_visibility, expertise_summary, bio, profile_sections, status,
  weekly_capacity, priority, source_date
from pg_catalog.jsonb_to_recordset(${sqlJson(facultyManifest)}) as seed (
  name text, title text, employment_type text, consultation_role text, office text,
  phone text, email text, website text, contact_visibility jsonb, expertise_summary text,
  bio text, profile_sections jsonb, status text, weekly_capacity smallint,
  priority smallint, source_date date
);

insert into public.faculty_tags (
  faculty_id, tag_key, tag_label, category, weight, is_primary
)
select faculty.id, seed.tag_key, seed.tag_label, seed.category, seed.weight, seed.is_primary
from pg_catalog.jsonb_to_recordset(${sqlJson(facultyTagManifest)}) as seed (
  faculty_name text, tag_key text, tag_label text, category text, weight smallint,
  is_primary boolean
)
join public.faculty as faculty on faculty.name = seed.faculty_name;

insert into public.faculty_specialist_links (
  primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template
)
select primary_faculty.id, specialist_faculty.id, seed.tag_key, seed.priority,
  seed.explanation_template
from pg_catalog.jsonb_to_recordset(${sqlJson(specialistLinkManifest)}) as seed (
  primary_faculty_name text, specialist_faculty_name text, tag_key text,
  priority smallint, explanation_template text
)
left join public.faculty as primary_faculty on primary_faculty.name = seed.primary_faculty_name
join public.faculty as specialist_faculty on specialist_faculty.name = seed.specialist_faculty_name;

commit;
`
}

const canonicalInput = (): RawContentSeedInputs => ({
  curriculum: JSON.parse(readFileSync('supabase/seed/curriculum-2026.json', 'utf8')) as unknown,
  faculty: JSON.parse(readFileSync('supabase/seed/faculty-2026.json', 'utf8')) as unknown,
  equipment: JSON.parse(readFileSync('supabase/seed/equipment-inventory-2026-07-14.json', 'utf8')) as unknown,
  facilities: JSON.parse(readFileSync('supabase/seed/facilities-2026.json', 'utf8')) as unknown,
  departmentArchive: JSON.parse(
    readFileSync('supabase/seed/department-archive-2026-05-26.json', 'utf8'),
  ) as unknown,
})

const runCli = () => {
  const arguments_ = process.argv.slice(2)
  if (arguments_.some(argument => !['--write', '--check'].includes(argument))
    || arguments_.length > 1) {
    throw new Error('usage: tsx scripts/seed-content.ts [--write|--check]')
  }
  const parsed = parseContentSeedInputs(canonicalInput())
  const seed = deriveContentSeed(parsed)
  const sql = generateContentSeedSql(parsed)
  const outputPath = resolve(CONTENT_SQL_PATH)

  if (arguments_[0] === '--write') {
    writeFileSync(outputPath, sql)
  }
  else if (arguments_[0] === '--check') {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== sql) {
      throw new Error(`${CONTENT_SQL_PATH} differs from the canonical JSON sources`)
    }
  }

  const summary = summarizeContentSeed(seed)
  console.log(
    `courses=${summary.courses} equipment_items=${summary.equipmentItems}`
    + ` facilities=${summary.facilities} extracurricular=${summary.extracurricular}`
    + ` projects=${summary.projects} careers=${summary.careers} faculty=${summary.faculty}`
    + ` resources=${summary.resources} equipment_groups=${summary.equipmentGroups}`
    + ` public_equipment_groups=${summary.publicEquipmentGroups}`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli()
}
