export interface SupportConfig {
  saweriaUsername: string
  trakteerUsername: string
  solanaAddress: string
  githubRepo: string
  discordInvite: string
}

export const DEFAULT_SUPPORT_CONFIG: SupportConfig = {
  saweriaUsername: 'feloapp',
  trakteerUsername: 'feloapp',
  solanaAddress: 'xfu6UYsfM9wXwZK1itHD3ordW2Km2u7D5AuKkd9qia1',
  githubRepo: 'FanX0/felo',
  discordInvite: 'https://discord.gg/K4We3eBqQ'
}

export const SUPPORT_CONFIG = DEFAULT_SUPPORT_CONFIG

export const FELO_APP_SETUP_URL = 'https://github.com/FanX0/felo/releases/latest/download/Felo-Setup.exe'
export const FELO_GITHUB_RELEASES_URL = 'https://github.com/FanX0/felo/releases'
export const FELO_ANDROID_APK_URL = 'https://github.com/FanX0/felo/releases/latest/download/Felo.apk'
export const FELO_IOS_IPA_URL = 'https://github.com/FanX0/felo/releases/latest/download/Felo.ipa'
export const FELO_TESTFLIGHT_URL = ''
export const FELO_PLAYSTORE_URL = ''
export const FELO_DISCORD_BOT_INVITE_URL =
  'https://discord.com/oauth2/authorize?client_id=1559904111883714691&permissions=274878285888&scope=bot%20applications.commands'

export function buildSaweriaUrl(usernameOrUrl?: string): string {
  const clean = (usernameOrUrl || '').trim()
  if (!clean || clean === 'fanx0' || clean === 'feloapp') return 'https://saweria.co/feloapp'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  return `https://saweria.co/${clean.replace(/^@/, '')}`
}

export function buildTrakteerUrl(usernameOrUrl?: string): string {
  const clean = (usernameOrUrl || '').trim()
  if (!clean || clean === 'fanx0' || clean === 'feloapp') return 'https://trakteer.id/feloapp/tip'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  const stripped = clean.replace(/^@/, '')
  return stripped.includes('/') ? `https://trakteer.id/${stripped}` : `https://trakteer.id/${stripped}/tip`
}

export function buildGithubRepoUrl(repo?: string): string {
  const clean = (repo || '').trim()
  if (!clean) return 'https://github.com/FanX0/felo'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  return `https://github.com/${clean.replace(/^\//, '')}`
}

export function buildSolscanUrl(address?: string): string {
  const clean = (address || '').trim()
  if (!clean) return 'https://solscan.io'
  return `https://solscan.io/account/${clean}`
}

export function buildDiscordInviteUrl(urlOrCode?: string): string {
  const clean = (urlOrCode || '').trim()
  if (!clean) return 'https://discord.gg/K4We3eBqQ'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  return `https://discord.gg/${clean.replace(/^(https?:\/\/)?(discord\.gg\/|discord\.com\/invite\/)?/, '')}`
}

export function buildDiscordBotInviteUrl(customClientId?: string): string {
  const clientId = (customClientId || '').trim() || '1559904111883714691'
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=274878285888&scope=bot%20applications.commands`
}

export function useSupportConfig() {
  return {
    config: DEFAULT_SUPPORT_CONFIG,
    isLoaded: true,
    updateConfig: async () => {}
  }
}
