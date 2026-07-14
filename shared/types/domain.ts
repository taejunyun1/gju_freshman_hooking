export const trackKeys = ['documentary', 'art_photo', 'commercial', 'video'] as const
export const questionGroups = ['work', 'result', 'style', 'career'] as const
export const visualKeys = [
  'photo_frame',
  'video_frame',
  'edit_timeline',
  'studio_still',
  'interview_strip',
  'location_board',
  'gallery_grid',
  'music_cuts',
  'photobook_spread',
  'project_board',
  'contact_sheet',
] as const

export const trackLabels = {
  documentary: '다큐멘터리',
  art_photo: '예술사진',
  commercial: '광고사진',
  video: '영상',
} as const satisfies Record<TrackKey, string>

export type TrackKey = typeof trackKeys[number]
export type QuestionGroup = typeof questionGroups[number]
export type VisualKey = typeof visualKeys[number]
export type OptionStatus = 'draft' | 'active' | 'archived'
export type TrackWeights = Record<TrackKey, number>

export interface AssessmentOption {
  group: QuestionGroup
  optionKey: `${QuestionGroup}.${string}`
  label: string
  description?: string
  visualKey: VisualKey
  trackWeights: TrackWeights
  interestTags: string[]
  status: OptionStatus
  sortOrder: number
}

export interface AssessmentSelections {
  work: `work.${string}`[]
  result: `result.${string}`[]
  style: `style.${string}`[]
  career: `career.${string}`[]
  careerOther: string | null
}
