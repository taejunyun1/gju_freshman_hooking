import { PUBLIC_COUNSELING_RECIPIENT, publicCounselingSchema, type PublicExploreInput } from '../../../shared/schemas/public-explore'
import { trackLabels } from '../../../shared/types/domain'
import type { ResultSnapshot } from '../../../shared/types/result'

export type CounselingEmail = {
  to: string
  from: { email: string, name: string }
  subject: string
  text: string
}

export class PublicExploreError extends Error {
  constructor(readonly code: 'PUBLIC_INPUT_INVALID' | 'PUBLIC_EMAIL_FAILED' | 'PUBLIC_EMAIL_UNAVAILABLE' | 'PUBLIC_FORBIDDEN' | 'PUBLIC_RATE_LIMITED' | 'PUBLIC_UNAVAILABLE', readonly status = 422) {
    super(code)
  }
}

export const createPublicCounselingService = (dependencies: {
  recommend: (input: PublicExploreInput) => Promise<ResultSnapshot>
  send: (email: CounselingEmail) => Promise<unknown>
}) => ({
  async submit(raw: unknown): Promise<{ sent: true }> {
    const parsed = publicCounselingSchema.safeParse(raw)
    if (!parsed.success) throw new PublicExploreError('PUBLIC_INPUT_INVALID')
    const { name, phone, question, selections, catalogRevision, visitorSeed } = parsed.data
    const result = await dependencies.recommend({ selections, catalogRevision, visitorSeed })
    const text = [
      '광주대학교 사진영상미디어학과 · 공개 진로 탐색 상담 신청',
      '', `이름: ${name}`, `휴대전화: ${phone}`,
      `추천 분야: ${trackLabels[result.rankedTracks[0]]}`,
      `함께 살펴볼 분야: ${trackLabels[result.rankedTracks[1]]}`,
      `추천 상담교수: ${result.faculty.primary.name} (확정 배정 아님)`,
      '', '선택한 관심사:', ...result.selectedInterests.map(item => `- ${item.label}`),
      '', '학년별 추천 교과:',
      ...result.learningPath.map(year => `${year.year}학년: ${year.resources.map(course => course.title).join(', ') || '상담 시 안내'}`),
      '', `질문: ${question || '별도 질문 없음'}`,
      '', '신청자가 이름·연락처·질문·추천 요약의 학과 이메일 전달에 동의했습니다.',
      '공개 설문은 회원 계정이나 학생 DB에 저장되지 않습니다. 상담 목적 외 사용을 삼가 주세요.',
    ].join('\n')
    try {
      await dependencies.send({
        to: PUBLIC_COUNSELING_RECIPIENT,
        from: { email: 'counseling@gjuphoto.com', name: '광주대학교 사진영상미디어학과' },
        subject: '[PHOTO:NEXT] 새로운 진로 상담 신청', text,
      })
    }
    catch { throw new PublicExploreError('PUBLIC_EMAIL_FAILED', 503) }
    return { sent: true }
  },
})
