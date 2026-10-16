import { ipcMain } from 'electron'
import { DownloadService } from '../services/DownloadService'

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function formatProviderError(source: 'qobuz' | 'deezer', raw: string): string {
  const normalized = raw.toLowerCase()
  if (source === 'qobuz') {
    if (normalized.includes('invalid credentials') || normalized.includes('401')) {
      return 'Authentication failed: Invalid credentials or expired user token. Please check your User ID and Auth Token / Password.'
    }
    if (
      normalized.includes('invalid app id') ||
      normalized.includes('invalidappiderror') ||
      normalized.includes('400')
    ) {
      return 'Invalid Qobuz App ID. Clear the App ID & App Secret fields in Settings to allow automatic detection.'
    }
    if (
      normalized.includes('free accounts are not eligible') ||
      normalized.includes('ineligibleerror')
    ) {
      return 'Free Qobuz account detected. Full-track streaming and downloading require an active Qobuz subscription or trial.'
    }
    if (normalized.includes('missingcredentialserror')) {
      return 'Missing credentials: Email/User ID and Auth Token/Password are required.'
    }
  } else {
    if (normalized.includes('authenticationerror') || normalized.includes('login_via_arl')) {
      return 'Deezer authentication failed: The ARL cookie token is invalid or has expired. Please grab a fresh "arl" cookie from deezer.com in your browser.'
    }
    if (normalized.includes('missingcredentialserror')) {
      return 'Missing credentials: Deezer ARL cookie token is required.'
    }
  }

  if (normalized.includes('enoent') || normalized.includes('was not found')) {
    return `${source === 'qobuz' ? 'Qobuz' : 'Deezer'} service is currently unreachable.`
  }

  return raw
}

export function testQobuzAccount(accounts: any) {
  const hasIdentity = isNonEmptyString(accounts?.qobuzUser)
  const hasSecret = isNonEmptyString(accounts?.qobuzSecret)

  if (!hasIdentity || !hasSecret) {
    return {
      status: 'error' as const,
      message: 'Qobuz test failed: Email / User ID and Auth Token (or Password) are required.'
    }
  }

  return {
    status: 'success' as const,
    message: 'Qobuz configuration is complete.'
  }
}

export function testDeezerAccount(accounts: any) {
  const arl = typeof accounts?.deezerArl === 'string' ? accounts.deezerArl.replace(/\s+/g, '') : ''

  if (!arl) {
    return {
      status: 'error' as const,
      message: 'Deezer test failed: ARL cookie token is required.'
    }
  }

  if (arl.length < 32) {
    return {
      status: 'error' as const,
      message: 'Deezer test failed: ARL cookie token looks too short.'
    }
  }

  return {
    status: 'success' as const,
    message: 'Deezer configuration is complete.'
  }
}

export function registerStreamingIpc(): void {
  // Streaming account tests: mirror the reference app's {status, message} contract.
  ipcMain.handle('streaming:testQobuz', async (_, accounts: any) => {
    const validation = testQobuzAccount(accounts)
    if (validation.status === 'error') return validation
    try {
      await DownloadService.search('qobuz', 'Daft Punk One More Time', accounts)
      return { status: 'success', message: 'Qobuz account connected and verified successfully!' }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: formatProviderError('qobuz', raw), rawError: raw }
    }
  })

  ipcMain.handle('streaming:testDeezer', async (_, accounts: any) => {
    const validation = testDeezerAccount(accounts)
    if (validation.status === 'error') return validation
    try {
      await DownloadService.search('deezer', 'Daft Punk One More Time', accounts)
      return { status: 'success', message: 'Deezer account connected and verified successfully!' }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: formatProviderError('deezer', raw), rawError: raw }
    }
  })

  ipcMain.handle('streaming:testSoulseek', async (_, accounts: any) => {
    try {
      const results = await DownloadService.search('soulseek', 'Daft Punk', accounts || {})
      return {
        status: 'success',
        message: `Connected to Soulseek P2P network (${results.length} peer matches found)!`
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: `Soulseek connection failed: ${raw}`, rawError: raw }
    }
  })
}
