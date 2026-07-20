import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createContentRevision,
  deriveContentSeed,
  generateContentSeedSql,
  parseContentSeedInputs,
  summarizeContentSeed,
} from '../../../scripts/seed-content'

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown

const canonicalInput = () => ({
  curriculum: readJson('supabase/seed/curriculum-2026.json'),
  faculty: readJson('supabase/seed/faculty-2026.json'),
  equipment: readJson('supabase/seed/equipment-inventory-2026-07-14.json'),
  facilities: readJson('supabase/seed/facilities-2026.json'),
  departmentArchive: readJson('supabase/seed/department-archive-2026-05-26.json'),
})

const expectedCourseTitles = [
  '흑백사진과 암실',
  '사진영상학개론',
  '기초사진실기',
  '영상 에세이 메이킹',
  '영상 프레임과 컷',
  '라이팅과 스튜디오',
  '이미지와사회',
  '디지털 포토 에디팅',
  'AI와 이미지 메이킹',
  '디지털 이미지 제작과 프린트',
  '사진사',
  '영상드론기초',
  '내러티브 영상촬영',
  '응용 디지털 촬영',
  '사진커뮤니케이션',
  '영상 컬러와 포스트 프로덕션',
  '리서치와 레퍼런스 이미지 제작',
  '비주얼 스토리 메이킹',
  '다큐멘터리 메이킹&쇼케이스',
  '사진교과교육론',
  '사진교수학습방법',
  '커머셜 포토그라피 기초 워크숍',
  '포토 스토리 워크숍',
  '영상 인터뷰 내러티브 워크숍',
  '사물,데이터,이미지 워크숍',
  '커머셜 포토그라피 심화 워크숍',
  '포토에세이 워크숍',
  '영상 드론 콘텐츠 워크숍',
  '사진과 장소 그리고 콘텍스트 워크숍',
  '캡스톤 디자인1',
  '영상 콘텐츠 크리에이터 워크숍',
  '현장실습1',
  '현장실습2',
  '커머셜 포토그라피 세미나',
  '예술창작 프로젝트 세미나',
  '다큐멘터리 세미나',
  '캡스톤 디자인 2',
  '현장실습 4',
  '커머셜 포토그라피 랩',
  '예술창작 프로젝트 랩',
  '포스트 다큐멘터리 랩',
] as const

describe('verified department content seed', () => {
  it('preserves the exact ordered 2026 curriculum identity and draft contract', () => {
    const { curriculum } = parseContentSeedInputs(canonicalInput())

    expect(curriculum.map(course => course.title)).toEqual(expectedCourseTitles)
    expect(new Set(curriculum.map(course => course.title)).size).toBe(41)
    expect(curriculum.filter(course => course.gradeYear === 1)).toHaveLength(9)
    expect(curriculum.filter(course => course.gradeYear === 2)).toHaveLength(11)
    expect(curriculum.filter(course => course.gradeYear === 3)).toHaveLength(11)
    expect(curriculum.filter(course => course.gradeYear === 4)).toHaveLength(10)
    expect(curriculum.every(course => course.academicYear === 2026)).toBe(true)
    expect(curriculum.every(course => course.credits === 3 || course.title === '현장실습 4')).toBe(true)
    expect(curriculum.reduce((total, course) => total + course.credits, 0)).toBe(135)
    expect(curriculum.find(course => course.title === '현장실습 4')).toMatchObject({
      term: '2학기',
      credits: 15,
    })
    expect(curriculum.some(course => course.term === '매학기')).toBe(true)
    expect(curriculum.some(course => course.term === '방학중')).toBe(true)
    expect(Object.fromEntries(['1학기', '2학기', '매학기', '방학중'].map(term => [
      term,
      curriculum.filter(course => course.term === term).length,
    ]))).toEqual({ '1학기': 17, '2학기': 20, '매학기': 2, '방학중': 2 })
    expect(curriculum.filter(course => course.formerName !== null)).toHaveLength(27)
    expect(curriculum.filter(course => course.sourceFormerLabel === '신규')).toHaveLength(1)
    expect(curriculum.filter(course => course.fusionMajor !== null)).toHaveLength(5)
    expect(curriculum.every(course => course.sourceDate === '2026-07-14')).toBe(true)
    expect(curriculum.every(course => course.sourceDocument === '2026학년도 개설 예정')).toBe(true)
    expect(curriculum.every(course => course.status === 'draft' && course.visibility === 'public')).toBe(true)
    expect(curriculum.every(course => course.tags.length > 0)).toBe(true)
  })

  it('keeps PDF source wording separate from proofread summaries and covers five paths', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))
    const courses = seed.resources.filter(resource => resource.type === 'course')
    const byTitle = (title: string) => courses.find(course => course.title === title)

    expect(byTitle('이미지와사회')?.metadata.source_goal)
      .toBe('이미지가 사회에 미친 영향을 역사적 순서대로 보면서 연구한다')
    expect(byTitle('디지털 포토 에디팅')?.metadata.source_goal).toBe(
      '사진, 이미지를 다루는 포토샵 기초 테크닉괴. 실제 촬영 이미지를 기반으로 AI(Stable Diffusion, VEO3 등)를 활용해 창의적 이미지 제작한다.',
    )
    expect(byTitle('현장실습 4')?.metadata.source_goal)
      .toBe('한학기 → 방학기간 중 실 기업체의 현장실습을 통해 실무역량을 강화하고 취업기회를 확대함.')
    expect(byTitle('디지털 포토 에디팅')?.summary)
      .not.toBe(byTitle('디지털 포토 에디팅')?.metadata.source_goal)
    expect(byTitle('흑백사진과 암실')?.metadata.former_name).toBe('흑백사진편집실기')
    expect(byTitle('기초사진실기')?.metadata.fusion_major)
      .toBe('디지털이미지처리(마이크로디그리)')

    const courseTags = new Set(seed.resourceTags
      .filter(tag => courses.some(course => course.seedKey === tag.resourceSeedKey))
      .map(tag => tag.tagKey))
    for (const pathTags of [
      ['commercial', 'fashion', 'studio'],
      ['documentary', 'social_record'],
      ['video', 'narrative', 'content'],
      ['art_photo', 'research', 'exhibition'],
      ['editing', 'ai_image', 'drone', 'technique'],
    ]) {
      expect(pathTags.every(tag => courseTags.has(tag))).toBe(true)
    }
  })

  it('preserves the four supporting time-instructor identities and their non-primary roles', () => {
    const { faculty } = parseContentSeedInputs(canonicalInput())

    expect(faculty.filter(person => person.title === '시간강사').map(person => person.name))
      .toEqual(['정한결', '유별남', '김태현', '김명우'])
    expect(faculty.filter(person => person.employmentType === 'full_time')).toHaveLength(3)
    expect(faculty.filter(person => person.consultationRole === 'primary')).toHaveLength(3)
    expect(faculty.filter(person => person.consultationRole === 'specialist')).toHaveLength(7)
    expect(faculty.filter(person => person.title === '시간강사')
      .every(person => person.employmentType === 'practitioner' && person.consultationRole === 'specialist'))
      .toBe(true)
    expect(faculty.filter(person => person.title === '시간강사')
      .every(person => person.weeklyCapacity === 0 && person.sourceDate === '2026-07-20'))
      .toBe(true)
    expect(faculty.every(person => person.status === 'draft')).toBe(true)
    expect(faculty.filter(person => person.title !== '시간강사').every(person => Object.values(person.contactVisibility)
      .every(visibility => visibility === 'admin_only'))).toBe(true)
    expect(faculty.filter(person => person.title === '시간강사').map(person => ({
      name: person.name,
      website: person.website,
      visibility: person.contactVisibility,
      lastVerifiedAt: person.lastVerifiedAt,
    }))).toEqual([
      { name: '정한결', website: null, visibility: { office: 'hidden', phone: 'hidden', email: 'hidden', website: 'hidden' }, lastVerifiedAt: null },
      { name: '유별남', website: 'https://www.yoobeylnam.com/', visibility: { office: 'hidden', phone: 'hidden', email: 'hidden', website: 'public' }, lastVerifiedAt: '2026-07-20T00:00:00+09:00' },
      { name: '김태현', website: 'https://studio.underyourwater.com/', visibility: { office: 'hidden', phone: 'hidden', email: 'hidden', website: 'public' }, lastVerifiedAt: '2026-07-20T00:00:00+09:00' },
      { name: '김명우', website: null, visibility: { office: 'hidden', phone: 'hidden', email: 'hidden', website: 'hidden' }, lastVerifiedAt: null },
    ])
    expect(faculty.every(person => person.expertiseSummary.length > 0)).toBe(true)
    expect(faculty.every(person => person.profile.length > 0)).toBe(true)
    expect(faculty.filter(person => person.name !== '정한결' && person.name !== '유별남')
      .every(person => person.education.length > 0)).toBe(true)
    expect(faculty.filter(person => person.name !== '유별남').every(person => person.careers.length > 0)).toBe(true)
    expect(faculty.every(person => person.teachingFields.length > 0)).toBe(true)
    expect(faculty.every(person => person.studentProjects.length > 0)).toBe(true)
    expect(faculty.every(person => person.platformTags.length > 0)).toBe(true)
    expect(faculty.map(person => person.platformTags.length)).toEqual([8, 12, 9, 7, 6, 8, 4, 3, 3, 4])
    expect(faculty.reduce((total, person) => total + person.platformTags.length, 0)).toBe(64)
    expect(faculty.find(person => person.name === '윤태준')).toMatchObject({
      expertiseSummary: '현대예술·예술사진·영상·AI·기술적 이미지',
    })
    expect(faculty.find(person => person.name === '김사라')?.institutionProjects).toHaveLength(14)
    expect(faculty.find(person => person.name === '곽동욱')?.careerPaths).toEqual([])
  })

  it('derives locked faculty weights and the thirty priority specialist links', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))

    expect(seed.facultyTags.filter(tag => tag.source === 'platform')
      .every(tag => tag.weight === 3 && tag.isPrimary)).toBe(true)
    expect(Object.fromEntries(['track', 'activity', 'result', 'specialist'].map(category => [
      category,
      seed.facultyTags.filter(tag => tag.source === 'platform' && tag.category === category).length,
    ]))).toEqual({ track: 5, activity: 17, result: 7, specialist: 35 })
    expect(seed.facultyTags.filter(tag => tag.source === 'teaching')
      .every(tag => tag.category === 'activity' && tag.weight === 2 && !tag.isPrimary)).toBe(true)
    expect(seed.facultyTags.filter(tag => tag.source === 'project')
      .every(tag => tag.category === 'result' && tag.weight === 2 && !tag.isPrimary)).toBe(true)
    expect(seed.facultyTags.filter(tag => tag.source === 'career')
      .every(tag => tag.category === 'career' && tag.weight === 3 && !tag.isPrimary)).toBe(true)
    expect(seed.facultyTags.filter(tag => tag.facultyName === '박재웅' && tag.source === 'platform')
      .every(tag => tag.category === 'specialist')).toBe(true)
    expect(seed.facultyTags).toHaveLength(224)
    expect(seed.facultyTags.some(tag => tag.tagKey === 'technical_image')).toBe(false)
    expect(seed.facultyTags.filter(tag => tag.facultyName === '윤태준'
      && tag.category === 'result'
      && tag.tagLabel === 'AI 이미지·영상 프로젝트').map(tag => tag.tagKey))
      .toEqual(['ai'])
    expect(['video', 'ai', 'photography'].every(tagKey => seed.facultyTags.some(tag => (
      tag.facultyName === '윤태준' && tag.category === 'result' && tag.tagKey === tagKey
    )))).toBe(true)
    expect(seed.facultyTags.some(tag => tag.facultyName === '윤태준'
      && tag.category === 'activity'
      && tag.tagLabel === '영상 프레임과 컷'
      && tag.tagKey === 'framing')).toBe(true)

    expect(seed.specialistLinks).toHaveLength(30)
    expect(seed.specialistLinks.every(link => link.priority === 100)).toBe(true)
    expect(seed.specialistLinks.filter(link => link.primaryFacultyName === '윤태준'
      && link.specialistFacultyName === '박재웅').map(link => link.tagKey))
      .toEqual(['video', 'drone', 'vr', 'video_360'])
    expect(seed.specialistLinks.filter(link => link.primaryFacultyName === '윤태준'
      && link.specialistFacultyName === '정철호').map(link => link.tagKey))
      .toEqual(['exhibition', 'curating', 'art_theory'])
    expect(seed.specialistLinks.filter(link => link.primaryFacultyName === null
      && link.specialistFacultyName === '곽동욱').map(link => link.tagKey))
      .toEqual(['commercial', 'fashion', 'product', 'beauty', 'brand', 'studio', 'lighting'])
  })

  it('allows missing education or career evidence only for the documented supporting profiles', () => {
    const input = canonicalInput()
    const facultyInput = input.faculty as { faculty: Array<Record<string, unknown>> }
    const yoon = facultyInput.faculty.find(person => person.name === '윤태준')!
    yoon.education = []
    expect(() => parseContentSeedInputs(input)).toThrow()

    const supportingInput = canonicalInput()
    const supportingFaculty = supportingInput.faculty as { faculty: Array<Record<string, unknown>> }
    expect(supportingFaculty.faculty.find(person => person.name === '정한결')?.education).toEqual([])
    expect(supportingFaculty.faculty.find(person => person.name === '유별남')?.education).toEqual([])
    expect(supportingFaculty.faculty.find(person => person.name === '유별남')?.careers).toEqual([])
    expect(() => parseContentSeedInputs(supportingInput)).not.toThrow()
  })

  it('keeps the populated-database forward migration aligned with the canonical supporting data', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))
    const names = new Set(['정한결', '유별남', '김태현', '김명우'])
    const migration = readFileSync(
      'supabase/migrations/202607200033_supporting_instructors_release.sql',
      'utf8',
    )
    const expectedFaculty = seed.faculty.filter(person => names.has(person.name)).map(person => ({
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
      status: 'active',
      weekly_capacity: 0,
      priority: 0,
      source_date: person.sourceDate,
      last_verified_at: person.lastVerifiedAt,
    }))
    const expectedTags = seed.facultyTags.filter(tag => names.has(tag.facultyName)).map(tag => ({
      faculty_name: tag.facultyName,
      tag_key: tag.tagKey,
      tag_label: tag.tagLabel,
      category: tag.category,
      weight: tag.weight,
      is_primary: tag.isPrimary,
    }))
    const expectedLinks = seed.specialistLinks.filter(link => names.has(link.specialistFacultyName))
      .map(link => ({
        primary_faculty_name: link.primaryFacultyName,
        specialist_faculty_name: link.specialistFacultyName,
        tag_key: link.tagKey,
        priority: link.priority,
        explanation_template: link.explanationTemplate,
      }))

    expect(migration.match(/\$faculty\$(.*?)\$faculty\$/u)?.[1]).toBe(JSON.stringify(expectedFaculty))
    expect(migration.match(/\$tags\$(.*?)\$tags\$/u)?.[1]).toBe(JSON.stringify(expectedTags))
    expect(migration.match(/\$links\$(.*?)\$links\$/u)?.[1]).toBe(JSON.stringify(expectedLinks))
  })

  it('preserves all 144 inventory identities and locked quality states', () => {
    const { equipment } = parseContentSeedInputs(canonicalInput())
    const duplicatedCodes = new Set([
      'LEN-8LENS-01',
      'DRN-DJI-01',
      'DRN-DJI2-01',
      'ETC-360-01',
      'ETC-DJI-01',
    ])

    expect(equipment).toHaveLength(144)
    expect(equipment.map(item => item.sourceRow)).toEqual(
      Array.from({ length: 144 }, (_, index) => index + 1),
    )
    expect(equipment.filter(item => item.locationKey === 'department_equipment_room')).toHaveLength(83)
    expect(equipment.filter(item => item.locationKey === 'fantasy_lab')).toHaveLength(61)
    expect(equipment.filter(item => item.accessMode === 'reservation')).toHaveLength(81)
    expect(equipment.filter(item => item.accessMode === 'inquiry')).toHaveLength(63)
    expect(equipment.filter(item => item.dataQualityStatus === 'duplicate_code')).toHaveLength(10)
    expect(equipment.filter(item => item.dataQualityStatus === 'unidentified')
      .map(item => item.inventoryCode)).toEqual(['LEN-ITEM010-01', 'LEN-ITEM010-02'])
    expect(equipment.filter(item => item.dataQualityStatus === 'quantity_check')
      .map(item => item.inventoryCode)).toEqual([
        'ETC-ITEM034-01',
        'ETC-ITEM035-01',
        'ETC-ITEM037-01',
        'ETC-ITEM036-01',
      ])
    expect(equipment.filter(item => item.dataQualityStatus === 'duplicate_code')
      .every(item => duplicatedCodes.has(item.inventoryCode))).toBe(true)
    for (const inventoryCode of duplicatedCodes) {
      expect(equipment.filter(item => item.inventoryCode === inventoryCode)).toHaveLength(2)
    }
    expect(equipment.filter(item => item.dataQualityStatus === 'verified')).toHaveLength(128)
    expect(Object.fromEntries(['body', 'lens', 'lighting', 'audio', 'drone', 'other'].map(category => [
      category,
      equipment.filter(item => item.category === category).length,
    ]))).toEqual({ body: 24, lens: 34, lighting: 30, audio: 25, drone: 8, other: 23 })
    expect(equipment.every(item => item.availabilityState === 'available')).toBe(true)
    expect(equipment.every(item => item.sourceDate === '2026-07-14')).toBe(true)
  })

  it('keeps every approved internal canonical source byte-for-byte unchanged', () => {
    const expectedHashes = {
      'supabase/seed/curriculum-2026.json': '832a19636a0a24703903b0f2f769146879eb17231cb3edab81a5717dc8f00324',
      'supabase/seed/equipment-inventory-2026-07-14.json': 'efbef180c706b7412ab0ea6f51a920e698c3ec00c159d7449818dfaad60728eb',
      'supabase/seed/facilities-2026.json': '3b1fa7e941b88b0558a7decb4203082fdf5332adc3dbefdfcfdaf3cf0674e48c',
      'supabase/seed/faculty-2026.json': 'e4a6b371e0ddada905341743464eff98b532d7d2d6efe092657640e4699179b3',
    }

    for (const [path, expected] of Object.entries(expectedHashes)) {
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(expected)
    }
  })

  it('adds only bounded draft archive evidence with exact alumni, activity, and facility counts', () => {
    const parsed = parseContentSeedInputs(canonicalInput())
    const seed = deriveContentSeed(parsed)
    const archiveResources = seed.resources.filter(resource => resource.seedKey.startsWith('archive:'))
    const career = archiveResources.filter(resource => resource.type === 'career')
    const extracurricular = archiveResources.filter(resource => resource.type === 'extracurricular')
    const projects = archiveResources.filter(resource => resource.type === 'project')
    const facilities = archiveResources.filter(resource => resource.type === 'facility')

    expect(parsed.departmentArchive.alumni.map(person => person.name)).toEqual([
      '서재훈', '김수성', '설소영', '김민범', '윤동규', '노하윤', '박지우', '박준희',
      '임승찬', '최관호', '김병준', '유성현', '정해찬', '김윤교', '박래현', '박진우', '유승현',
    ])
    expect(career).toHaveLength(17)
    expect(extracurricular).toHaveLength(5)
    expect(projects).toHaveLength(5)
    expect(facilities.map(resource => resource.metadata.facilityKey)).toEqual([
      'studio_c_video', 'print_lab', 'portfolio_review_lab',
    ])
    expect(seed.resources.filter(resource => resource.type === 'facility')).toHaveLength(7)
    expect(seed.resources).toHaveLength(158)
    expect(seed.equipmentInventory).toHaveLength(144)
    expect(archiveResources.every(resource => resource.status === 'draft')).toBe(true)
    expect(archiveResources.some(resource => resource.type === 'student_work')).toBe(false)
    expect(JSON.stringify(parsed.departmentArchive)).not.toMatch(/동아리|학생회|학생자치/u)

    const evidenceStatuses = archiveResources.map(resource => (
      (resource.metadata.archive as { evidenceStatus: string }).evidenceStatus
    ))
    expect(Object.fromEntries(['snapshot', 'historical', 'verify_required', 'recurring'].map(status => [
      status,
      evidenceStatuses.filter(value => value === status).length,
    ]))).toEqual({ snapshot: 15, historical: 6, verify_required: 8, recurring: 1 })
    expect(archiveResources.filter(resource => (
      (resource.metadata.archive as { evidenceStatus: string }).evidenceStatus === 'historical'
    )).every(resource => resource.summary.includes('과거 운영 사례'))).toBe(true)
  })

  it('preserves source, role-state, and track evidence without exposing unverified conflict', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))
    const archiveResources = seed.resources.filter(resource => resource.seedKey.startsWith('archive:'))
    const careers = archiveResources.filter(resource => resource.type === 'career')
    const roleStatuses = careers.map(resource => resource.metadata.roleStatus)
    const conflicted = careers.find(resource => resource.metadata.publicName === '김병준')
    const graduationConflict = careers.find(resource => resource.metadata.publicName === '윤동규')
    const trackKeys = new Set(['documentary', 'art_photo', 'commercial', 'video'])

    expect(roleStatuses.filter(status => status === 'title_confirmed')).toHaveLength(10)
    expect(roleStatuses.filter(status => status === 'body_only')).toHaveLength(6)
    expect(roleStatuses.filter(status => status === 'conflicted')).toHaveLength(1)
    expect(conflicted).toMatchObject({ visibility: 'admin_only' })
    expect(conflicted?.metadata).toMatchObject({
      graduationYear: 2023,
      roleStatus: 'conflicted',
      roleAtSource: null,
      roleCandidates: ['VFX 영상편집자', '1인 프로덕션 CP'],
    })
    expect(graduationConflict).toMatchObject({ visibility: 'admin_only' })
    expect(graduationConflict?.metadata).toMatchObject({
      graduationYear: null,
      graduationYearStatus: 'conflicted',
      graduationYearCandidates: [
        {
          year: 2024,
          sourceUrl: 'https://gjphoto94.notion.site/2a163cb8bb55800c9057c4973527db76?source=copy_link',
        },
        { year: 2023, sourceUrl: 'https://gjuphoto.com/?kboard_content_redirect=12' },
      ],
    })
    expect(careers.filter(resource => resource.metadata.graduationYearStatus === 'confirmed'))
      .toHaveLength(16)
    expect(archiveResources.every((resource) => {
      const archive = resource.metadata.archive as {
        sourceUrl: string
        sourceLastEditedDate: string
        trackEvidence: string[]
      }
      return archive.sourceUrl.startsWith('https://')
        && /^\d{4}-\d{2}-\d{2}$/u.test(archive.sourceLastEditedDate)
        && archive.trackEvidence.length >= 1
        && archive.trackEvidence.every(track => trackKeys.has(track))
    })).toBe(true)

    for (const resource of archiveResources) {
      const tags = seed.resourceTags.filter(tag => tag.resourceSeedKey === resource.seedKey)
      expect(tags.filter(tag => tag.isPrimary)).toHaveLength(1)
      expect(trackKeys.has(tags.find(tag => tag.isPrimary)!.tagKey)).toBe(true)
      expect(tags.some(tag => !trackKeys.has(tag.tagKey))).toBe(true)
    }

    expect(seed.resources.filter(resource => resource.type === 'equipment' || resource.type === 'facility')
      .every(resource => resource.metadata.supportingEvidence === true)).toBe(true)
  })

  it('groups public equipment without codes and retains four support facilities exactly', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))
    const publicEquipment = seed.resources.filter(resource => resource.type === 'equipment'
      && resource.visibility === 'public')
    const facilities = seed.resources.filter(resource => resource.type === 'facility'
      && !resource.seedKey.startsWith('archive:'))

    expect(seed.resources.filter(resource => resource.type === 'equipment')).toHaveLength(83)
    expect(publicEquipment).toHaveLength(72)
    expect(seed.resources.filter(resource => resource.type === 'equipment'
      && resource.visibility === 'admin_only')).toHaveLength(11)
    expect(publicEquipment.reduce(
      (total, resource) => total + Number(resource.metadata.confirmedQuantity),
      0,
    )).toBe(128)
    expect(publicEquipment.every(resource => resource.status === 'draft')).toBe(true)
    expect(seed.resources.filter(resource => !resource.seedKey.startsWith('archive:'))).toHaveLength(128)
    expect(seed.resources).toHaveLength(158)
    expect(seed.resources.every(resource => resource.status === 'draft')).toBe(true)
    expect(publicEquipment.every(resource => resource.metadata.reservationUrl
      === 'https://gjureserve.co.kr')).toBe(true)
    expect(publicEquipment.every(resource => resource.metadata.accessLabel
      === (resource.metadata.accessMode === 'reservation' ? '예약 가능' : '문의 전용'))).toBe(true)
    const inventoryCodes = parseContentSeedInputs(canonicalInput()).equipment
      .map(item => item.inventoryCode)
    expect(publicEquipment.every(resource => inventoryCodes
      .every(code => !JSON.stringify(resource).includes(code)))).toBe(true)

    expect(facilities.map(resource => resource.metadata.facilityKey))
      .toEqual(['studio_a_horizon', 'studio_b', 'darkroom', 'computer_lab'])
    expect(facilities.every(resource => resource.status === 'draft'
      && resource.visibility === 'public')).toBe(true)
    expect(facilities.map(resource => resource.metadata.operationNote)).toEqual([
      '시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.',
      '시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.',
      '시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.',
      '2020년형 iMac 및 RTX 4080급 그래픽카드 탑재 워크스테이션이 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.',
    ])
    expect(facilities.every(resource => resource.metadata.lastVerifiedAt
      === '2026-07-18T16:28:30+09:00')).toBe(true)
    expect(facilities.every(resource => resource.metadata.location_label
      === '사진영상미디어학과')).toBe(true)
    expect(facilities.find(resource => resource.metadata.facilityKey === 'studio_a_horizon')
      ?.metadata.activities).toEqual(['호리존을 활용한 인물·패션·제품·광고·영상 촬영'])
    expect(facilities.find(resource => resource.metadata.facilityKey === 'computer_lab')
      ?.metadata.exampleCourses).toEqual([
        '디지털 포토 에디팅',
        '디지털 이미지 제작과 프린트',
        '영상 컬러와 포스트 프로덕션',
        'AI와 이미지 메이킹',
      ])
  })

  it('validates exact manifests and generates byte-stable owner seed SQL', () => {
    const parsed = parseContentSeedInputs(canonicalInput())
    const seed = deriveContentSeed(parsed)
    const firstSql = generateContentSeedSql(parsed)
    const secondSql = generateContentSeedSql(parseContentSeedInputs(canonicalInput()))

    expect(summarizeContentSeed(seed)).toMatchObject({
      courses: 41,
      equipmentItems: 144,
      facilities: 7,
      careers: 17,
      extracurricular: 5,
      projects: 5,
      faculty: 10,
      verifiedEquipmentItems: 128,
      resources: 158,
      equipmentGroups: 83,
      publicEquipmentGroups: 72,
      adminOnlyEquipmentGroups: 11,
      specialistLinks: 30,
    })
    expect(secondSql).toBe(firstSql)
    expect(createContentRevision(parsed)).toBe(
      'sha256:597e673e87ad120a3890630b84358dd921e1a880b40fff08caa68696b0e48bd2',
    )
    expect(firstSql).toContain(`Content revision: ${createContentRevision(parsed)}`)
    expect(firstSql).toContain('begin;')
    expect(firstSql).toContain('pg_advisory_xact_lock')
    expect(firstSql).toContain('lock table public.resources')
    expect(firstSql).toContain('content seed target tables are not empty')
    expect(firstSql).toContain("not like 'project_catalog:%'")
    expect(firstSql).toContain('commit;')
    expect(firstSql).not.toMatch(/grant\s+(insert|update|delete)/iu)

    const malformed = canonicalInput() as {
      curriculum: unknown[]
      faculty: unknown
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    malformed.curriculum = malformed.curriculum.slice(1)
    expect(() => parseContentSeedInputs(malformed)).toThrow(/curriculum.*41/iu)
  })

  it('rejects unknown fields, duplicate identities, broken references, and count drift', () => {
    const unknownField = canonicalInput() as {
      curriculum: Array<Record<string, unknown>>
      faculty: unknown
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    unknownField.curriculum[0] = { ...unknownField.curriculum[0], unexpected: true }
    expect(() => parseContentSeedInputs(unknownField)).toThrow(/curriculum.*invalid/iu)

    const duplicateCourse = canonicalInput() as {
      curriculum: Array<Record<string, unknown>>
      faculty: unknown
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    duplicateCourse.curriculum[1] = {
      ...duplicateCourse.curriculum[1],
      title: duplicateCourse.curriculum[0]?.title,
    }
    expect(() => parseContentSeedInputs(duplicateCourse)).toThrow(/curriculum.*order|duplicate/iu)

    const brokenInventory = canonicalInput() as {
      curriculum: unknown
      faculty: unknown
      equipment: Array<Record<string, unknown>>
      facilities: unknown
      departmentArchive: unknown
    }
    brokenInventory.equipment[0] = { ...brokenInventory.equipment[0], sourceRow: 144 }
    expect(() => parseContentSeedInputs(brokenInventory)).toThrow(/equipment.*source.*row/iu)

    const brokenLink = canonicalInput() as {
      curriculum: unknown
      faculty: { faculty: unknown[], specialistLinks: Array<Record<string, unknown>> }
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    brokenLink.faculty.specialistLinks[0] = {
      ...brokenLink.faculty.specialistLinks[0],
      specialistFacultyName: '없는 교수',
    }
    expect(() => parseContentSeedInputs(brokenLink)).toThrow(/faculty.*link/iu)

    const wrongLocation = canonicalInput() as {
      curriculum: unknown
      faculty: unknown
      equipment: Array<Record<string, unknown>>
      facilities: unknown
      departmentArchive: unknown
    }
    wrongLocation.equipment[0] = {
      ...wrongLocation.equipment[0],
      locationKey: 'fantasy_lab',
    }
    expect(() => parseContentSeedInputs(wrongLocation)).toThrow(/equipment.*location.*count/iu)

    const wrongAccess = canonicalInput() as {
      curriculum: unknown
      faculty: unknown
      equipment: Array<Record<string, unknown>>
      facilities: unknown
      departmentArchive: unknown
    }
    wrongAccess.equipment[0] = { ...wrongAccess.equipment[0], accessMode: 'inquiry' }
    expect(() => parseContentSeedInputs(wrongAccess)).toThrow(/equipment.*access.*count/iu)

    const wrongRole = canonicalInput() as {
      curriculum: unknown
      faculty: { faculty: Array<Record<string, unknown>>, specialistLinks: unknown[] }
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    wrongRole.faculty.faculty[0] = {
      ...wrongRole.faculty.faculty[0],
      employmentType: 'adjunct',
    }
    expect(() => parseContentSeedInputs(wrongRole)).toThrow(/faculty.*role.*manifest/iu)

    const wrongLinkTag = canonicalInput() as {
      curriculum: unknown
      faculty: { faculty: unknown[], specialistLinks: Array<Record<string, unknown>> }
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    wrongLinkTag.faculty.specialistLinks[0] = {
      ...wrongLinkTag.faculty.specialistLinks[0],
      tagKey: 'promotion_video',
    }
    expect(() => parseContentSeedInputs(wrongLinkTag)).toThrow(/faculty.*link.*manifest/iu)

    const sourceDrift = canonicalInput() as {
      curriculum: Array<Record<string, unknown>>
      faculty: unknown
      equipment: unknown
      facilities: unknown
      departmentArchive: unknown
    }
    sourceDrift.curriculum[0] = {
      ...sourceDrift.curriculum[0],
      summary: '검수되지 않은 변경',
    }
    expect(() => parseContentSeedInputs(sourceDrift)).toThrow(/manifest.*approved/iu)
  })
})
