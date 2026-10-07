import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeResultSnapshot } from '../../fixtures/result'
import Page from '../../../app/pages/explore.vue'

const storageKey = 'photo-next:public-explore:v1'
const catalog = {
  catalogRevision: `sha256:${'a'.repeat(64)}`,
  groups: [
    { key: 'work', options: [{ key: 'work.photo', label: '사진 촬영', visualKey: 'photo_frame' }] },
    { key: 'result', options: [{ key: 'result.portfolio', label: '포트폴리오', visualKey: 'gallery_grid' }] },
    { key: 'style', options: [{ key: 'style.solo', label: '개인 작업', visualKey: 'project_board' }] },
    { key: 'career', options: [{ key: 'career.photo', label: '사진 진로', visualKey: 'photo_frame' }] },
  ],
  limits: { work: { min: 1, max: 4 }, result: { min: 1, max: 3 }, style: { min: 1, max: 2 }, career: { min: 1, max: 2 } },
}
const stored = () => ({
  catalogRevision: catalog.catalogRevision, visitorSeed: 123, step: 3, sent: true,
  selections: { work: ['work.photo'], result: ['result.portfolio'], style: ['style.solo'], career: ['career.photo'], careerOther: null },
  snapshot: makeResultSnapshot(),
})
const wrappers: ReturnType<typeof mount>[] = []
const mountPage = async () => {
  const wrapper = mount(Page, { global: { stubs: { PublicExploreResult: { template: '<div data-saved-result />' }, PublicCounselingForm: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const showPage = async (persisted: boolean) => {
  const event = new Event('pageshow')
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
  await flushPromises()
}

describe('public survey visit lifetime', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(storageKey, JSON.stringify(stored()))
    vi.stubGlobal('useSeoMeta', vi.fn())
    vi.stubGlobal('useHead', vi.fn())
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ data: catalog }))
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'navigate' }] as PerformanceEntry[])
  })
  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it.each(['navigate', 'back_forward', undefined])('starts empty on entry type %s', async (type) => {
    vi.mocked(performance.getEntriesByType).mockReturnValue(type ? [{ type }] as PerformanceEntry[] : [])
    const wrapper = await mountPage()
    expect(wrapper.find('[data-saved-result]').exists()).toBe(false)
    expect(wrapper.text()).toContain('01 / 04')
    expect(wrapper.findAll('input:checked')).toHaveLength(0)
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({ step: 0, snapshot: null, sent: false })
  })
  it('restores the current survey on an ordinary refresh', async () => {
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' }] as PerformanceEntry[])
    const wrapper = await mountPage()
    expect(wrapper.find('[data-saved-result]').exists()).toBe(true)
    await showPage(false)
    expect(wrapper.find('[data-saved-result]').exists()).toBe(true)
  })
  it('clears a result restored by the browser back-forward cache', async () => {
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' }] as PerformanceEntry[])
    const wrapper = await mountPage()
    await showPage(true)
    expect(wrapper.find('[data-saved-result]').exists()).toBe(false)
    expect(wrapper.text()).toContain('01 / 04')
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({ step: 0, snapshot: null, sent: false })
  })
  it('removes tab storage on client-side route departure', async () => {
    const wrapper = await mountPage()
    wrapper.unmount()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })
  it('does not recreate storage if options arrive after route departure', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('$fetch', vi.fn().mockReturnValue(new Promise(done => { resolve = done })))
    const wrapper = await mountPage()
    wrapper.unmount()
    resolve({ data: catalog })
    await flushPromises()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })
  it('still loads a fresh survey when tab storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('01 / 04')
    expect(wrapper.find('[data-saved-result]').exists()).toBe(false)
  })
})
