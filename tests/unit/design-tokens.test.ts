import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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
  it('contains the approved blue palette and semantic error color', () => {
    const css = readFileSync('app/assets/css/tokens.css', 'utf8')
    for (const color of ['#2563EB', '#14213D', '#EAF1FF', '#F5F8FF', '#FFFFFF', '#58677F', '#C53B3B']) {
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
    const dynamicPackages = {
      'wanted-sans': {
        version: '1.0.3',
        cssPath: 'fonts/webfonts/variable/split/WantedSansVariable.css',
      },
      pretendard: {
        version: '1.3.9',
        cssPath: 'dist/web/variable/pretendardvariable-dynamic-subset.css',
      },
    }
    const requiredPackages = {
      ...dynamicPackages,
      '@fontsource/ibm-plex-mono': {
        version: '5.2.7',
      },
    }

    expect(packageJson.dependencies).toMatchObject(Object.fromEntries(
      Object.entries(requiredPackages).map(([packageName, contract]) => [packageName, contract.version]),
    ))
    expect(readFileSync('nuxt.config.ts', 'utf8')).toContain("'~/assets/css/fonts.css'")
    expect(existsSync('app/assets/css/fonts.css')).toBe(true)

    const fontCss = readFileSync('app/assets/css/fonts.css', 'utf8')
    for (const [packageName, contract] of Object.entries(dynamicPackages)) {
      expect(fontCss).toContain(`@import '${packageName}/${contract.cssPath}';`)
      const packageRoot = resolve('node_modules', packageName)
      const subsetCssPath = resolve(packageRoot, contract.cssPath)
      const subsetCss = readFileSync(subsetCssPath, 'utf8')
      const subsetSources = [...subsetCss.matchAll(/src:\s*url\(["']?(?<path>[^"')]+\.woff2)/gu)]
      const unicodeRanges = subsetCss.match(/unicode-range:/gu) ?? []

      expect(subsetSources.length).toBeGreaterThanOrEqual(90)
      expect(unicodeRanges).toHaveLength(subsetSources.length)
      for (const source of subsetSources) {
        expect(existsSync(resolve(dirname(subsetCssPath), source.groups!.path))).toBe(true)
      }
    }
    expect(fontCss).not.toContain('/complete/')
    expect(fontCss).not.toContain('PretendardVariable.woff2')
    expect(fontCss).toContain('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')
    expect(fontCss).toContain('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2')
    expect(fontCss.match(/format\('woff2'\)/gu)).toHaveLength(2)
    expect(fontCss).not.toContain("format('woff')")

    for (const packageName of Object.keys(requiredPackages)) {
      const packageRoot = resolve('node_modules', packageName)
      const fontPackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
        license?: string
      }
      expect(fontPackage.license).toBe('OFL-1.1')
      expect([
        resolve(packageRoot, 'LICENSE'),
        resolve(packageRoot, 'LICENSE.md'),
        resolve(packageRoot, 'OFL.txt'),
        resolve(packageRoot, 'fonts/OFL.txt'),
        resolve(packageRoot, 'dist/LICENSE.txt'),
      ].some(existsSync)).toBe(true)
    }
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
      hexToRgb('#14213D'),
      hexToRgb('#F5F8FF'),
      Number(footerColor?.[1]),
    )

    expect(tokens).toContain('--color-canvas: #F5F8FF')
    expect(contrastRatio(footerText, hexToRgb('#F5F8FF'))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps every sequence clip label at WCAG AA contrast on its tinted background', () => {
    const page = readFileSync('app/pages/index.vue', 'utf8')
    const clipLabel = page.match(/\.sequence__clip-label \{([\s\S]*?)\n\}/)?.[1]
    const sequenceClip = page.match(/\.sequence__clip \{([\s\S]*?)\n\}/)?.[1]
    const labelOpacity = clipLabel?.match(/color: color-mix\(in srgb, var\(--color-ink\) (\d+)%, transparent\);/)
    const sequenceTint = sequenceClip?.match(/background: color-mix\(in srgb, var\(--color-sequence\) (\d+)%, var\(--color-surface\)\);/)

    expect(labelOpacity).toBeDefined()
    expect(sequenceTint).toBeDefined()

    const labelOpacityPercentage = Number(labelOpacity?.[1])
    const clipBackgrounds = [
      mix(hexToRgb('#2563EB'), hexToRgb('#FFFFFF'), Number(sequenceTint?.[1])),
    ]

    for (const clipBackground of clipBackgrounds) {
      const labelText = mix(hexToRgb('#14213D'), clipBackground, labelOpacityPercentage)
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
    const foreground = labelMix?.name === 'ink' ? '#14213D' : undefined
    const background = tokens.match(new RegExp(`--color-${backgroundToken}:\\s*(#[0-9A-F]{6})`, 'u'))?.[1]

    expect(labelMix?.percentage).toBeDefined()
    expect(foreground).toBeDefined()
    expect(background).toBeDefined()

    const backgroundRgb = hexToRgb(background!)
    const label = mix(hexToRgb(foreground!), backgroundRgb, Number(labelMix?.percentage))
    expect(contrastRatio(label, backgroundRgb)).toBeGreaterThanOrEqual(4.5)
  })
})
