export interface ResourceMatchTag {
  readonly key: string
  readonly weight: number
  readonly isPrimary: boolean
}

export interface SelectedInterestEvidence {
  readonly key: string
  readonly label: string
}

export interface ConnectionReasonInput {
  readonly interestVector: Readonly<Record<string, number>>
  readonly selectedInterests: readonly SelectedInterestEvidence[]
  readonly resourceTags: readonly ResourceMatchTag[]
  readonly resourceTitle: string
  readonly goalSummary: string
}

const compareKeys = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)

const assertInterestVector = (interestVector: Readonly<Record<string, number>>): void => {
  for (const [key, score] of Object.entries(interestVector)) {
    if (key.trim().length === 0 || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error('Interest score must be finite and between 0 and 1')
    }
  }
}

const assertResourceTags = (tags: readonly ResourceMatchTag[]): void => {
  for (const tag of tags) {
    if (tag.key.trim().length === 0
      || !Number.isFinite(tag.weight)
      || tag.weight < 0
      || tag.weight > 3) {
      throw new Error('Resource tag weight must be finite and between 0 and 3')
    }
  }
}

export const renderConnectionReason = (input: ConnectionReasonInput): string => {
  if (input.resourceTitle.trim().length === 0) throw new Error('Resource title is required')
  if (input.goalSummary.trim().length === 0) throw new Error('Resource goal is required')

  assertInterestVector(input.interestVector)
  assertResourceTags(input.resourceTags)

  const labels = new Map<string, string>()
  for (const selected of input.selectedInterests) {
    if (selected.key.trim().length === 0 || selected.label.trim().length === 0) {
      throw new Error('Selected label evidence is required')
    }
    if (labels.has(selected.key)) throw new Error('Duplicate selected label evidence')
    labels.set(selected.key, selected.label)
  }

  const strongestMatch = input.resourceTags
    .map(tag => ({
      key: tag.key,
      weight: tag.weight,
      score: input.interestVector[tag.key] ?? 0,
    }))
    .filter(match => match.weight > 0 && match.score > 0)
    .sort((left, right) => (
      (right.score * right.weight) - (left.score * left.weight)
      || right.weight - left.weight
      || compareKeys(left.key, right.key)
    ))[0]

  if (!strongestMatch) throw new Error('No matched interest tag')

  const label = labels.get(strongestMatch.key)
  if (!label) throw new Error('Selected label evidence is missing for the strongest match')

  return `선택한 ‘${label}’ 관심이 ${input.goalSummary} ‘${input.resourceTitle}’과 연결됩니다.`
}
