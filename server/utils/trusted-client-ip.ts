type TrustedClientIpDependencies = {
  getDirectIp: (event: unknown) => string | undefined
  getHeader: (event: unknown, name: string) => string | undefined
  isCloudflare: (event: unknown) => boolean
}

const isValidIpv4 = (value: string): boolean => {
  const parts = value.split('.')
  return parts.length === 4 && parts.every(part => (
    /^(?:0|[1-9][0-9]{0,2})$/u.test(part) && Number(part) <= 255
  ))
}

const isValidIpv6 = (value: string): boolean => {
  if (value.length < 2 || value.length > 45 || !value.includes(':') || !/^[0-9A-Fa-f:.]+$/u.test(value)) return false
  try {
    const parsed = new URL(`http://[${value}]/`)
    return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
  }
  catch {
    return false
  }
}

const isValidIp = (value: string | undefined): value is string => (
  typeof value === 'string'
  && value.length <= 45
  && (isValidIpv4(value) || isValidIpv6(value))
)

export const createTrustedClientIpReader = (
  dependencies: TrustedClientIpDependencies,
) => (event: unknown): string => {
  if (dependencies.isCloudflare(event)) {
    const cloudflareIp = dependencies.getHeader(event, 'cf-connecting-ip')
    if (isValidIp(cloudflareIp)) return cloudflareIp
  }

  const directIp = dependencies.getDirectIp(event)
  return isValidIp(directIp) ? directIp : 'unknown'
}

export const getTrustedClientIp = createTrustedClientIpReader({
  getDirectIp: event => getRequestIP(event as never) ?? undefined,
  getHeader: (event, name) => getHeader(event as never, name),
  isCloudflare: event => Boolean((event as { context?: { cloudflare?: unknown } }).context?.cloudflare),
})
