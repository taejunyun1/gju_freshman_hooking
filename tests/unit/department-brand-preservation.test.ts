import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(path, 'utf8')

describe('department brand preservation', () => {
  it('preserves historical degree and graduation records in the faculty directory guide', () => {
    const facultyGuide = read('docs/content/faculty-directory-guide.md')

    expect(facultyGuide).toContain('2010 광주대학교 사진영상학과 미술학사')
    expect(facultyGuide).toContain('2017 광주대학교 사진영상학과 졸업')
  })

  it('preserves the archived source page titles', () => {
    const archive = JSON.parse(read('supabase/seed/department-archive-2026-05-26.json')) as {
      alumni: { sourcePageTitle: string }[]
      activities: { sourcePageTitle: string }[]
      facilities: { sourcePageTitle: string }[]
    }
    const sourcePageTitles = [
      ...archive.alumni,
      ...archive.activities,
      ...archive.facilities,
    ].map(entry => entry.sourcePageTitle)

    expect(sourcePageTitles).toContain('졸업생 인터뷰')
    expect(sourcePageTitles).toContain('광주대학교 사진영상미디어학과')
    expect(sourcePageTitles).toContain('학과 시설 및 기자재')
  })

  it('does not use the retired department name in current UI entries', () => {
    const currentUiEntries = [
      'app/pages/index.vue',
      'app/pages/login.vue',
      'app/pages/assessment.vue',
      'app/pages/history.vue',
      'app/pages/counseling.vue',
      'app/pages/result/[publicId].vue',
      'app/components/result/ResultTimeline.vue',
      'app/components/counseling/CounselingForm.vue',
      'app/pages/admin/login.vue',
      'app/layouts/admin.vue',
      'app/pages/admin/index.vue',
    ]

    for (const entry of currentUiEntries) {
      expect(read(entry), entry).not.toContain('광주대학교 사진영상학과')
    }
  })
})
