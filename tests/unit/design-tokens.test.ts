import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('bundles the three approved OFL font packages through the Nuxt CSS build', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const requiredPackages = {
      'wanted-sans': {
        version: '1.0.3',
        assetPath: 'fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2',
      },
      pretendard: {
        version: '1.3.9',
        assetPath: 'dist/web/variable/woff2/PretendardVariable.woff2',
      },
      '@fontsource/ibm-plex-mono': {
        version: '5.2.7',
        assetPath: 'files/ibm-plex-mono-latin-400-normal.woff2',
      },
    }

    expect(packageJson.dependencies).toMatchObject(Object.fromEntries(
      Object.entries(requiredPackages).map(([packageName, contract]) => [packageName, contract.version]),
    ))
    expect(readFileSync('nuxt.config.ts', 'utf8')).toContain("'~/assets/css/fonts.css'")
    expect(existsSync('app/assets/css/fonts.css')).toBe(true)

    const fontCss = readFileSync('app/assets/css/fonts.css', 'utf8')
    for (const [packageName, contract] of Object.entries(requiredPackages)) {
      expect(fontCss).toContain(`${packageName}/${contract.assetPath}`)
      const packageRoot = resolve('node_modules', packageName)
      const fontPackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
        license?: string
      }
      expect(fontPackage.license).toBe('OFL-1.1')
      expect(existsSync(resolve(packageRoot, contract.assetPath))).toBe(true)
      expect([
        resolve(packageRoot, 'LICENSE'),
        resolve(packageRoot, 'LICENSE.md'),
        resolve(packageRoot, 'OFL.txt'),
        resolve(packageRoot, 'fonts/OFL.txt'),
        resolve(packageRoot, 'dist/LICENSE.txt'),
      ].some(existsSync)).toBe(true)
    }
    expect(fontCss.match(/format\('woff2(?:-variations)?'\)/gu)).toHaveLength(4)
    expect(fontCss).not.toContain("format('woff')")
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

  it('keeps every sequence clip label at WCAG AA contrast on its tinted background', () => {
    const page = readFileSync('app/pages/index.vue', 'utf8')
    const clipLabel = page.match(/\.sequence__clip-label \{([\s\S]*?)\n\}/)?.[1]
    const sequenceClip = page.match(/\.sequence__clip \{([\s\S]*?)\n\}/)?.[1]
    const signalClip = page.match(/\.sequence__clip--signal \{([\s\S]*?)\n\}/)?.[1]
    const labelOpacity = clipLabel?.match(/color: color-mix\(in srgb, var\(--color-ink\) (\d+)%, transparent\);/)
    const sequenceTint = sequenceClip?.match(/background: color-mix\(in srgb, var\(--color-sequence\) (\d+)%, var\(--color-surface\)\);/)
    const signalTint = signalClip?.match(/background: color-mix\(in srgb, var\(--color-signal\) (\d+)%, var\(--color-surface\)\);/)

    expect(labelOpacity).toBeDefined()
    expect(sequenceTint).toBeDefined()
    expect(signalTint).toBeDefined()

    const labelOpacityPercentage = Number(labelOpacity?.[1])
    const clipBackgrounds = [
      mix(hexToRgb('#6B43B5'), hexToRgb('#FFFFFF'), Number(sequenceTint?.[1])),
      mix(hexToRgb('#C27628'), hexToRgb('#FFFFFF'), Number(signalTint?.[1])),
    ]

    for (const clipBackground of clipBackgrounds) {
      const labelText = mix(hexToRgb('#151A22'), clipBackground, labelOpacityPercentage)
      expect(contrastRatio(labelText, clipBackground)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the 10px secure-operations label at WCAG AA contrast on the login panel', () => {
    const page = readFileSync('app/pages/admin/login.vue', 'utf8')
    const tokens = readFileSync('app/assets/css/tokens.css', 'utf8')
    const loginLabel = page.match(/\.admin-login__header > span \{(?<body>[\s\S]*?)\}/u)?.groups?.body
    const panel = page.match(/\.admin-login__panel\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body
    const labelMix = loginLabel?.match(/color:\s*color-mix\(in srgb, var\(--color-(?<name>[a-z-]+)\) (?<percentage>\d+)%, transparent\)/u)?.groups
    const backgroundToken = panel?.match(/background:\s*var\(--color-(?<name>[a-z-]+)\)/u)?.groups?.name
    const foreground = tokens.match(new RegExp(`--color-${labelMix?.name}:\\s*(#[0-9A-F]{6})`, 'u'))?.[1]
    const background = tokens.match(new RegExp(`--color-${backgroundToken}:\\s*(#[0-9A-F]{6})`, 'u'))?.[1]

    expect(labelMix?.percentage).toBeDefined()
    expect(foreground).toBeDefined()
    expect(background).toBeDefined()

    const backgroundRgb = hexToRgb(background!)
    const label = mix(hexToRgb(foreground!), backgroundRgb, Number(labelMix?.percentage))
    expect(contrastRatio(label, backgroundRgb)).toBeGreaterThanOrEqual(4.5)
  })
})
