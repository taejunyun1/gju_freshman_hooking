import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design tokens', () => {
  it('contains the six approved brand colors and semantic error color', () => {
    const css = readFileSync('app/assets/css/tokens.css', 'utf8')
    for (const color of ['#FFFFFF', '#EEF1F6', '#151A22', '#6B43B5', '#2E7773', '#C27628', '#B8423E']) {
      expect(css).toContain(color)
    }
  })

  it('defines the minimum touch target contract', () => {
    const css = readFileSync('app/assets/css/tokens.css', 'utf8')
    expect(css).toContain('--touch-target: 44px')
  })
})
