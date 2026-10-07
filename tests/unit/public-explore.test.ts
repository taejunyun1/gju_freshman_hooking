import { describe, expect, it, vi } from 'vitest'
import { publicCounselingSchema, publicExploreSchema } from '../../shared/schemas/public-explore'
import { createPublicCounselingService } from '../../server/modules/public-explore/counseling'

const recommendation = {
  rankedTracks: ['video', 'art_photo', 'documentary', 'commercial'],
  selectedInterests: [{ label: '영상 편집', key: 'work.video_edit', group: 'work' }],
  learningPath: [{ year: 1, resources: [{ title: '영상 프레임과 컷' }] }],
  faculty: { primary: { name: '윤태준' } },
}
const assessment = {
  catalogRevision: `sha256:${'a'.repeat(64)}`, visitorSeed: 123,
  selections: { work: ['work.video_scene'], result: ['result.video'], style: ['style.solo'], career: ['career.video'], careerOther: null },
}
const input = () => ({ ...assessment, name: '홍길동', phone: '010-9000-0001', question: '편집 수업이 궁금합니다.', consent: true, website: '' })

describe('public counseling', () => {
  it('requires consent, a valid phone and bounded fields; rejects recipient injection', () => {
    expect(publicCounselingSchema.safeParse(input()).success).toBe(true)
    for (const value of [
      { ...input(), consent: false }, { ...input(), phone: '123' },
      { ...input(), name: 'x\nBcc: attacker@example.com' },
      { ...input(), question: 'x'.repeat(1001) },
      { ...input(), to: 'attacker@example.com' }, { ...input(), website: 'spam' },
    ]) expect(publicCounselingSchema.safeParse(value).success).toBe(false)
    expect(publicExploreSchema.safeParse({ ...assessment, prospectId: 1 }).success).toBe(false)
  })

  it('recomputes the result and sends only to the fixed department email', async () => {
    const recommend = vi.fn(async () => recommendation as never)
    const send = vi.fn(async () => undefined)
    const service = createPublicCounselingService({ recommend, send })
    await expect(service.submit(input())).resolves.toEqual({ sent: true })
    expect(recommend).toHaveBeenCalledWith(assessment)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({ to: 'photographygju@gmail.com', from: { email: 'counseling@gjuphoto.com' } })
    expect(send.mock.calls[0]![0].text).toContain('01090000001')
    expect(send.mock.calls[0]![0].text).toContain('영상 편집')
    expect(send.mock.calls[0]![0].text).toContain('영상 프레임과 컷')
  })

  it('does not claim success when email fails or send before valid consent', async () => {
    const send = vi.fn(async () => { throw new Error('provider secret details') })
    const service = createPublicCounselingService({ recommend: async () => recommendation as never, send })
    await expect(service.submit({ ...input(), consent: false })).rejects.toThrow('PUBLIC_INPUT_INVALID')
    expect(send).not.toHaveBeenCalled()
    await expect(service.submit(input())).rejects.toThrow('PUBLIC_EMAIL_FAILED')
  })
})
