export const OAUTH_CALLBACK_PREFIX = 'felo://auth/callback'

/**
 * Searches process command-line arguments for a felo:// OAuth callback deep link.
 * Handles surrounding quotes, trailing slashes, host/path variations, and case-insensitivity.
 */
export function findOAuthCallback(args: string[]): string | undefined {
  if (!Array.isArray(args)) return undefined
  for (const rawArg of args) {
    if (typeof rawArg !== 'string') continue
    const clean = rawArg.trim().replace(/^["']|["']$/g, '')
    const lower = clean.toLowerCase()
    if (lower.startsWith('felo://auth/callback') || lower.startsWith('felo:///auth/callback')) {
      return clean
    }
  }
  return undefined
}

/**
 * Validates that a string is a valid felo://auth/callback deep link URL.
 */
export function isValidOAuthCallback(callbackUrl: string): boolean {
  if (typeof callbackUrl !== 'string') return false
  const cleanUrl = callbackUrl.trim().replace(/^["']|["']$/g, '')
  try {
    const parsed = new URL(cleanUrl)
    const normalizedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase()
    const hostname = parsed.hostname.toLowerCase()
    const isDirectHost = hostname === 'auth' && normalizedPath === '/callback'
    const isPathOnly = hostname === '' && normalizedPath === '/auth/callback'
    return parsed.protocol.toLowerCase() === 'felo:' && (isDirectHost || isPathOnly)
  } catch {
    return false
  }
}
