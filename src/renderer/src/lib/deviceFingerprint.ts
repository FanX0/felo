/**
 * Deterministic Device & Network Fingerprint
 *
 * Computes a stable, privacy-preserving device hash to pair instances
 * running on the exact same physical machine across different origins
 * (e.g. localhost:5173 vs deployed domain like felo.pages.dev)
 * even without requiring user authentication.
 */

function getWebGLRenderer(): string {
  if (typeof window === 'undefined') return ''
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl') ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return ''
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ''
  } catch {
    return ''
  }
}

let cachedDeviceKey: string | null = null
let cachedPublicIp: string | null = null
let ipFetchPromise: Promise<string | null> | null = null

async function resolvePublicIp(): Promise<string | null> {
  if (cachedPublicIp) return cachedPublicIp
  if (ipFetchPromise) return ipFetchPromise

  ipFetchPromise = (async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1800)
      const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) {
        const data = await res.json()
        if (data && typeof data.ip === 'string') {
          cachedPublicIp = data.ip.trim()
          return cachedPublicIp
        }
      }
    } catch {
      // Offline or network timeout - fallback to hardware-only fingerprint
    }
    return null
  })()

  return ipFetchPromise
}

export async function getDeterministicDeviceKey(): Promise<string> {
  if (cachedDeviceKey) return cachedDeviceKey

  const ip = await resolvePublicIp()

  const hardwareComponents = [
    typeof window !== 'undefined' ? window.screen.width : 0,
    typeof window !== 'undefined' ? window.screen.height : 0,
    typeof window !== 'undefined' ? window.screen.colorDepth : 0,
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    getWebGLRenderer(),
    typeof navigator !== 'undefined' ? navigator.language : 'en'
  ]

  const raw = `${ip || 'local_machine'}:::${hardwareComponents.join('|')}`

  // 32-bit FNV-1a / Murmur-style hash
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  cachedDeviceKey = `dev_${Math.abs(hash >>> 0).toString(36)}`
  return cachedDeviceKey
}
