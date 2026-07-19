import { describe, expect, it } from 'vitest'

import {
  normalizeProjectCatalog,
  projectDisplayTierOf,
} from '../../scripts/project-catalog'

describe('project catalog', () => {
  it('classifies 2026, 2025, and legacy projects without retaining cancelled rows', () => {
    const catalog = normalizeProjectCatalog([
      { key: 'current', year: 2026, title: 'AI 생성 동아리', cancelled: false },
      { key: 'recent', year: 2025, title: '드론 운용 동아리', cancelled: false },
      { key: 'legacy', year: 2024, title: '스마트 드론 활용', cancelled: false },
      { key: 'cancelled', year: 2026, title: '사진단오제(남구청)', cancelled: true },
    ])

    expect(catalog.map(row => row.key)).toEqual(['current', 'recent', 'legacy'])
    expect(projectDisplayTierOf(catalog[0]!)).toBe('current')
    expect(projectDisplayTierOf(catalog[1]!)).toBe('experience')
    expect(projectDisplayTierOf(catalog[2]!)).toBe('experience')
  })
})
