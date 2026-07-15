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

  it('preserves six complete faculty profiles with non-public contacts', () => {
    const { faculty } = parseContentSeedInputs(canonicalInput())

    expect(faculty.map(person => person.name))
      .toEqual(['조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'])
    expect(faculty.filter(person => person.employmentType === 'full_time')).toHaveLength(3)
    expect(faculty.filter(person => person.consultationRole === 'primary')).toHaveLength(3)
    expect(faculty.filter(person => person.consultationRole === 'specialist')).toHaveLength(3)
    expect(faculty.every(person => person.status === 'draft')).toBe(true)
    expect(faculty.every(person => Object.values(person.contactVisibility)
      .every(visibility => visibility === 'admin_only'))).toBe(true)
    expect(faculty.every(person => person.expertiseSummary.length > 0)).toBe(true)
    expect(faculty.every(person => person.profile.length > 0)).toBe(true)
    expect(faculty.every(person => person.education.length > 0)).toBe(true)
    expect(faculty.every(person => person.careers.length > 0)).toBe(true)
    expect(faculty.every(person => person.teachingFields.length > 0)).toBe(true)
    expect(faculty.every(person => person.studentProjects.length > 0)).toBe(true)
    expect(faculty.every(person => person.platformTags.length > 0)).toBe(true)
    expect(faculty.map(person => person.platformTags.length)).toEqual([8, 12, 9, 7, 6, 8])
    expect(faculty.reduce((total, person) => total + person.platformTags.length, 0)).toBe(50)
    expect(faculty.find(person => person.name === '윤태준')).toMatchObject({
      expertiseSummary: '현대예술·예술사진·영상·AI·기술적 이미지',
    })
    expect(faculty.find(person => person.name === '김사라')?.institutionProjects).toHaveLength(14)
    expect(faculty.find(person => person.name === '곽동욱')?.careerPaths).toEqual([])
  })

  it('derives locked faculty weights and the fourteen priority specialist links', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))

    expect(seed.facultyTags.filter(tag => tag.source === 'platform')
      .every(tag => tag.weight === 3 && tag.isPrimary)).toBe(true)
    expect(Object.fromEntries(['track', 'activity', 'result', 'specialist'].map(category => [
      category,
      seed.facultyTags.filter(tag => tag.source === 'platform' && tag.category === category).length,
    ]))).toEqual({ track: 5, activity: 17, result: 7, specialist: 21 })
    expect(seed.facultyTags.filter(tag => tag.source === 'teaching')
      .every(tag => tag.category === 'activity' && tag.weight === 2 && !tag.isPrimary)).toBe(true)
    expect(seed.facultyTags.filter(tag => tag.source === 'project')
      .every(tag => tag.category === 'result' && tag.weight === 2 && !tag.isPrimary)).toBe(true)
    expect(seed.facultyTags.filter(tag => tag.source === 'career')
      .every(tag => tag.category === 'career' && tag.weight === 3 && !tag.isPrimary)).toBe(true)
    expect(seed.facultyTags.filter(tag => tag.facultyName === '박재웅' && tag.source === 'platform')
      .every(tag => tag.category === 'specialist')).toBe(true)
    expect(seed.facultyTags).toHaveLength(174)
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

    expect(seed.specialistLinks).toHaveLength(14)
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

  it('groups public equipment without codes and retains four support facilities exactly', () => {
    const seed = deriveContentSeed(parseContentSeedInputs(canonicalInput()))
    const publicEquipment = seed.resources.filter(resource => resource.type === 'equipment'
      && resource.visibility === 'public')
    const facilities = seed.resources.filter(resource => resource.type === 'facility')

    expect(seed.resources.filter(resource => resource.type === 'equipment')).toHaveLength(83)
    expect(publicEquipment).toHaveLength(72)
    expect(seed.resources.filter(resource => resource.type === 'equipment'
      && resource.visibility === 'admin_only')).toHaveLength(11)
    expect(publicEquipment.reduce(
      (total, resource) => total + Number(resource.metadata.confirmedQuantity),
      0,
    )).toBe(128)
    expect(publicEquipment.every(resource => resource.status === 'draft')).toBe(true)
    expect(seed.resources).toHaveLength(128)
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
      '학과 확인 필요',
      '학과 확인 필요',
      '약품·장비·안전교육·운영 시간 확인 필요',
      '컴퓨터 수량·사양·설치 소프트웨어·운영 시간 확인 필요',
    ])
    expect(facilities.every(resource => resource.metadata.operationNote.includes('필요'))).toBe(true)
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
      facilities: 4,
      faculty: 6,
      verifiedEquipmentItems: 128,
      resources: 128,
      equipmentGroups: 83,
      publicEquipmentGroups: 72,
      adminOnlyEquipmentGroups: 11,
      specialistLinks: 14,
    })
    expect(secondSql).toBe(firstSql)
    expect(createContentRevision(parsed)).toBe(
      'sha256:2c4b0c5dfd8273b3914af083f8099a8f1be0a9c864d4d840a89fb6db296a69aa',
    )
    expect(firstSql).toContain(`Content revision: ${createContentRevision(parsed)}`)
    expect(firstSql).toContain('begin;')
    expect(firstSql).toContain('pg_advisory_xact_lock')
    expect(firstSql).toContain('lock table public.resources')
    expect(firstSql).toContain('content seed target tables are not empty')
    expect(firstSql).toContain('commit;')
    expect(firstSql).not.toMatch(/grant\s+(insert|update|delete)/iu)

    const malformed = canonicalInput() as {
      curriculum: unknown[]
      faculty: unknown
      equipment: unknown
      facilities: unknown
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
    }
    unknownField.curriculum[0] = { ...unknownField.curriculum[0], unexpected: true }
    expect(() => parseContentSeedInputs(unknownField)).toThrow(/curriculum.*invalid/iu)

    const duplicateCourse = canonicalInput() as {
      curriculum: Array<Record<string, unknown>>
      faculty: unknown
      equipment: unknown
      facilities: unknown
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
    }
    brokenInventory.equipment[0] = { ...brokenInventory.equipment[0], sourceRow: 144 }
    expect(() => parseContentSeedInputs(brokenInventory)).toThrow(/equipment.*source.*row/iu)

    const brokenLink = canonicalInput() as {
      curriculum: unknown
      faculty: { faculty: unknown[], specialistLinks: Array<Record<string, unknown>> }
      equipment: unknown
      facilities: unknown
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
    }
    wrongAccess.equipment[0] = { ...wrongAccess.equipment[0], accessMode: 'inquiry' }
    expect(() => parseContentSeedInputs(wrongAccess)).toThrow(/equipment.*access.*count/iu)

    const wrongRole = canonicalInput() as {
      curriculum: unknown
      faculty: { faculty: Array<Record<string, unknown>>, specialistLinks: unknown[] }
      equipment: unknown
      facilities: unknown
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
    }
    sourceDrift.curriculum[0] = {
      ...sourceDrift.curriculum[0],
      summary: '검수되지 않은 변경',
    }
    expect(() => parseContentSeedInputs(sourceDrift)).toThrow(/manifest.*approved/iu)
  })
})
