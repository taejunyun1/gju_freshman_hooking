import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PublicCounselingForm from '../../app/components/counseling/PublicCounselingForm.vue'

const assessment = {
  catalogRevision: `sha256:${'a'.repeat(64)}`, visitorSeed: 42,
  selections: { work: ['work.video_scene'], result: ['result.video'], style: ['style.solo'], career: ['career.video'], careerOther: null },
}
afterEach(() => vi.unstubAllGlobals())
describe('public counseling form', () => {
  it('formats phone digits, requires consent, prevents duplicate sends and clears contact data', async () => {
    let finish: (value: unknown) => void = () => undefined
    const fetch = vi.fn(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('$fetch', fetch)
    const view = mount(PublicCounselingForm, { props: { assessment, sent: false } })
    await view.get('[name=name]').setValue('홍길동')
    await view.get('[name=phone]').setValue('01090000001')
    expect((view.get('[name=phone]').element as HTMLInputElement).value).toBe('010-9000-0001')
    await view.get('form').trigger('submit')
    expect(fetch).not.toHaveBeenCalled()
    await view.get('[type=checkbox]').setValue(true)
    await view.get('form').trigger('submit')
    await view.get('form').trigger('submit')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(view.get('fieldset').attributes('disabled')).toBeDefined()
    finish({ data: { sent: true } })
    await flushPromises()
    expect(view.emitted('sent')).toHaveLength(1)
    expect((view.get('[name=name]').element as HTMLInputElement).value).toBe('')
    expect((view.get('[name=phone]').element as HTMLInputElement).value).toBe('')
    await view.setProps({ sent: true })
    expect(view.find('form').exists()).toBe(false)
  })

  it('shows server failure without falsely displaying success', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => { throw { data: { error: { message: '상담 메일 연결을 준비 중입니다.' } } } }))
    const view = mount(PublicCounselingForm, { props: { assessment, sent: false } })
    await view.get('[name=name]').setValue('홍길동')
    await view.get('[name=phone]').setValue('01090000001')
    await view.get('[type=checkbox]').setValue(true)
    await view.get('form').trigger('submit')
    await flushPromises()
    expect(view.get('[role=alert]').text()).toContain('연결을 준비')
    expect(view.emitted('sent')).toBeUndefined()
    expect((view.get('[name=name]').element as HTMLInputElement).value).toBe('홍길동')
  })
})
