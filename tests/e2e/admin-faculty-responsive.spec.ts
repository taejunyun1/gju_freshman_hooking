import { expect, test, type Page } from '@playwright/test'

import type {
  AdminFaculty,
  AdminFacultyListItem,
  AdminFacultyPreview,
} from '../../shared/schemas/admin-faculty'

const faculty: AdminFaculty = {
  id: 2,
  name: '조대연',
  title: '교수',
  employmentType: 'full_time',
  consultationRole: 'primary',
  office: '호심관 19층',
  phone: '062-670-2670',
  email: 'dancho@gwangju.ac.kr',
  website: null,
  contactVisibility: { office: 'admin_only', phone: 'hidden', email: 'public', website: 'hidden' },
  expertiseSummary: '다큐멘터리·포토커뮤니케이션·사회 기록',
  bio: '사람과 사회를 기록합니다.\n\n포토스토리를 지도합니다.',
  profileSections: {
    recommendationRole: '사회·사람 기록과 포토스토리 총괄',
    education: [],
    careers: [],
    teachingFields: ['포토커뮤니케이션'],
    studentProjects: [],
    careerPaths: [],
    institutionProjects: [],
    majorWorks: [],
  },
  weeklyCapacity: 4,
  priority: 10,
  sourceDate: '2026-07-14',
  lastVerifiedAt: '2026-07-14T02:00:00.654321Z',
  imagePath: null,
  tags: [{ key: 'documentary', label: '다큐멘터리 사진', category: 'track', weight: 3, isPrimary: true }],
  specialistLinks: [],
  status: 'draft',
  openAssignedCount: 1,
  createdAt: '2026-07-01T01:00:00.123456Z',
  updatedAt: '2026-07-15T01:00:00.123456Z',
}

const listItem: AdminFacultyListItem = {
  id: faculty.id,
  name: faculty.name,
  title: faculty.title,
  employmentType: faculty.employmentType,
  consultationRole: faculty.consultationRole,
  status: faculty.status,
  weeklyCapacity: faculty.weeklyCapacity,
  openAssignedCount: faculty.openAssignedCount,
  lastVerifiedAt: faculty.lastVerifiedAt,
  primaryTags: faculty.tags,
  updatedAt: faculty.updatedAt,
}

const person = (id: number, name: string, role: 'primary' | 'backup' | 'specialist') => ({
  id,
  name,
  title: role === 'specialist' ? '겸임교수' : '교수',
  role,
  expertise: `${name} 전문분야`,
  reason: `${name} 연결 이유입니다.`,
  publicContacts: {},
})
const preview: AdminFacultyPreview = {
  scenarios: [
    { key: 'social_photo_story', label: '사회 포토스토리', trackEvidence: 'documentary', recommendation: { primary: person(1, '조대연', 'primary'), backup: person(2, '윤태준', 'backup'), specialists: [], facultyFit: 91 } },
    { key: 'local_archive', label: '지역 아카이브', trackEvidence: 'documentary', recommendation: { primary: person(3, '김사라', 'primary'), backup: person(1, '조대연', 'backup'), specialists: [], facultyFit: 89 } },
    { key: 'video_drone', label: '영상·드론', trackEvidence: 'video', recommendation: { primary: person(2, '윤태준', 'primary'), backup: person(1, '조대연', 'backup'), specialists: [person(4, '박재웅', 'specialist')], facultyFit: 96 } },
    { key: 'commercial_fashion', label: '광고·패션', trackEvidence: 'commercial', recommendation: { primary: person(1, '조대연', 'primary'), backup: person(2, '윤태준', 'backup'), specialists: [person(6, '곽동욱', 'specialist')], facultyFit: 84 } },
  ],
}

const authorize = async (page: Page): Promise<void> => {
  await page.goto('/admin/login')
  await page.evaluate(() => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'route-intercepted-admin-session',
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      userId: '00000000-0000-4000-8000-000000000001',
    }))
  })
}

const noDocumentOverflow = async (page: Page): Promise<boolean> => page.evaluate(() => (
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
))

test('faculty list and real editor preserve responsive proof, keyboard, and reduced-motion contracts', async ({ page }) => {
  await page.route('**/api/admin/faculty**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let data: unknown
    if (request.method() === 'GET' && path === '/api/admin/faculty') {
      data = { items: [listItem], nextCursor: null }
    }
    else if (request.method() === 'GET' && path === '/api/admin/faculty/2') {
      data = { faculty }
    }
    else if (request.method() === 'POST' && path === '/api/admin/faculty/2/preview') {
      data = preview
    }
    else {
      await route.abort('blockedbyclient')
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, requestId: 'route-intercepted-e2e' }),
    })
  })
  await authorize(page)

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin/faculty')
    await expect(page.getByRole('heading', { name: '교수진 추천 운영' })).toBeVisible()
    await expect(page.locator('.faculty-list__table-wrap')).toBeHidden()
    await expect(page.locator('.faculty-list__cards')).toBeVisible()
    await expect(page.locator('[data-faculty-card]')).toHaveCount(1)
    expect(await noDocumentOverflow(page)).toBe(true)

    await page.goto('/admin/faculty/2')
    await expect(page.locator('[data-faculty-editor]')).toBeVisible()
    expect(await noDocumentOverflow(page)).toBe(true)
    const order = await page.locator('.faculty-editor__layout').evaluate((layout) => {
      const form = layout.querySelector('form')!.getBoundingClientRect()
      const proof = layout.querySelector('aside')!.getBoundingClientRect()
      return { formTop: form.top, proofTop: proof.top }
    })
    expect(order.proofTop).toBeGreaterThan(order.formTop)
  }

  await page.getByRole('button', { name: '추천 미리보기' }).click()
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(4)
  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.nth(1)).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedDuration = await tabs.nth(1).evaluate(element => getComputedStyle(element).transitionDuration)
  expect(['0s', '0.00001s', '1e-05s', '0.01ms']).toContain(reducedDuration)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/admin/faculty')
  await expect(page.locator('.faculty-list__table-wrap')).toBeVisible()
  await expect(page.locator('table[aria-label="교수진 운영 목록"]')).toBeVisible()
  await expect(page.locator('.faculty-list__cards')).toBeHidden()
  expect(await noDocumentOverflow(page)).toBe(true)

  await page.goto('/admin/faculty/2')
  await expect(page.locator('[data-faculty-editor]')).toBeVisible()
  const desktop = await page.locator('.faculty-editor__layout').evaluate((layout) => {
    const columns = getComputedStyle(layout).gridTemplateColumns.split(' ').map(value => Number.parseFloat(value))
    const form = layout.querySelector('form')!.getBoundingClientRect()
    const proof = layout.querySelector('aside')!
    const proofBox = proof.getBoundingClientRect()
    return {
      columnRatio: columns[0]! / columns[1]!,
      formTop: form.top,
      proofPosition: getComputedStyle(proof).position,
      proofTop: proofBox.top,
    }
  })
  expect(desktop.columnRatio).toBeGreaterThan(1.45)
  expect(desktop.columnRatio).toBeLessThan(1.55)
  expect(desktop.proofPosition).toBe('sticky')
  expect(Math.abs(desktop.formTop - desktop.proofTop)).toBeLessThan(2)
  expect(await noDocumentOverflow(page)).toBe(true)
})
