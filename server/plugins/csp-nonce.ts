type RenderHtmlContext = {
  body: string[]
  bodyAppend: string[]
  bodyPrepend: string[]
  head: string[]
}

type ParsedAttribute = {
  end: number
  name: string
  start: number
  value?: string
}

const trustedSections: Array<keyof Pick<RenderHtmlContext, 'head' | 'bodyPrepend' | 'bodyAppend'>> = [
  'head',
  'bodyPrepend',
  'bodyAppend',
]
const executableTag = /<(?:script|style)(?=[\s>])(?:"[^"]*"|'[^']*'|[^'"<>])*>/giu
const metaTag = /<meta(?=[\s>])(?:"[^"]*"|'[^']*'|[^'"<>])*>/giu
const whitespace = /\s/u

const parseAttributes = (source: string): ParsedAttribute[] => {
  const attributes: ParsedAttribute[] = []
  let cursor = 0

  while (cursor < source.length) {
    const start = cursor
    while (cursor < source.length && whitespace.test(source[cursor] ?? '')) cursor += 1
    if (cursor >= source.length || source[cursor] === '/') break

    const nameStart = cursor
    while (cursor < source.length && !/[\s=/>]/u.test(source[cursor] ?? '')) cursor += 1
    if (cursor === nameStart) {
      cursor += 1
      continue
    }

    const name = source.slice(nameStart, cursor).toLowerCase()
    const afterName = cursor
    while (cursor < source.length && whitespace.test(source[cursor] ?? '')) cursor += 1
    let value: string | undefined

    if (source[cursor] === '=') {
      cursor += 1
      while (cursor < source.length && whitespace.test(source[cursor] ?? '')) cursor += 1
      const quote = source[cursor]
      if (quote === '"' || quote === "'") {
        cursor += 1
        const valueStart = cursor
        while (cursor < source.length && source[cursor] !== quote) cursor += 1
        value = source.slice(valueStart, cursor)
        if (source[cursor] === quote) cursor += 1
      }
      else {
        const valueStart = cursor
        while (cursor < source.length && !/[\s>]/u.test(source[cursor] ?? '')) cursor += 1
        value = source.slice(valueStart, cursor)
      }
    }
    else {
      cursor = afterName
    }

    attributes.push({ end: cursor, name, start, value })
  }

  return attributes
}

const tagParts = (openTag: string): { attributes: string, closing: string, prefix: string } => {
  const prefix = openTag.match(/^<[^\s>]+/u)?.[0] ?? ''
  const closing = openTag.endsWith('/>') ? '/>' : '>'
  return {
    attributes: openTag.slice(prefix.length, -closing.length),
    closing,
    prefix,
  }
}

const stripNonceAttributes = (source: string): string => {
  const nonceAttributes = parseAttributes(source).filter(attribute => attribute.name === 'nonce')
  let cursor = 0
  let result = ''
  for (const attribute of nonceAttributes) {
    result += source.slice(cursor, attribute.start)
    cursor = attribute.end
  }
  return result + source.slice(cursor)
}

const normalizeExecutableTags = (chunk: string, nonce: string): string => chunk.replace(executableTag, (openTag) => {
  const { attributes, closing, prefix } = tagParts(openTag)
  return `${prefix} nonce="${nonce}"${stripNonceAttributes(attributes)}${closing}`
})

const removeViteNonceSignals = (chunk: string): string => chunk.replace(metaTag, (openTag) => {
  const { attributes } = tagParts(openTag)
  const property = parseAttributes(attributes).find(attribute => attribute.name === 'property')?.value
  return property?.toLowerCase() === 'csp-nonce' ? '' : openTag
})

export const applyCspNonce = (html: RenderHtmlContext, nonce: string): void => {
  html.head = html.head.map(removeViteNonceSignals)
  html.head.unshift(`<meta property="csp-nonce" nonce="${nonce}">`)

  for (const section of trustedSections) {
    html[section] = html[section].map(chunk => normalizeExecutableTags(chunk, nonce))
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.cspNonce
    if (typeof nonce === 'string') applyCspNonce(html, nonce)
  })
})
