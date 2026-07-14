import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Rgb = readonly [number, number, number]

const hexToRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

const mix = (foreground: Rgb, background: Rgb, foregroundPercentage: number): Rgb => {
  const alpha = foregroundPercentage / 100

  return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha)) as Rgb
}

const relativeLuminance = (color: Rgb) => {
  const [red, green, blue] = color.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrastRatio = (first: Rgb, second: Rgb) => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

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

  it('keeps footer text at WCAG AA contrast against the canvas', () => {
    const tokens = readFileSync('app/assets/css/tokens.css', 'utf8')
    const page = readFileSync('app/pages/index.vue', 'utf8')
    const footerBlocks = [...page.matchAll(/\.landing__footer \{([\s\S]*?)\n\}/g)]
    const footerColor = footerBlocks
      .map(([, block]) => block.match(/color: color-mix\(in srgb, var\(--color-ink\) (\d+)%, transparent\);/))
      .find(Boolean)

    expect(footerColor).toBeDefined()

    const footerText = mix(
      hexToRgb('#151A22'),
      hexToRgb('#EEF1F6'),
      Number(footerColor?.[1]),
    )

    expect(tokens).toContain('--color-canvas: #EEF1F6')
    expect(contrastRatio(footerText, hexToRgb('#EEF1F6'))).toBeGreaterThanOrEqual(4.5)
  })
})
