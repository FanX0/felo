import { useEffect, useState } from 'react'

export const SUPPORT_CONFIG_SETTING = 'felo:support_config'

export interface SupportConfig {
  saweriaUsername: string
  trakteerUsername: string
  solanaAddress: string
  githubRepo: string
}

export const DEFAULT_SUPPORT_CONFIG: SupportConfig = {
  saweriaUsername: 'fanx0',
  trakteerUsername: 'fanx0',
  solanaAddress: 'xfu6UYsfM9wXwZK1itHD3ordW2Km2u7D5AuKkd9qia1',
  githubRepo: 'FanX0/felo'
}

export function buildSaweriaUrl(usernameOrUrl: string): string {
  const clean = (usernameOrUrl || '').trim()
  if (!clean) return 'https://saweria.co/fanx0'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  return `https://saweria.co/${clean.replace(/^@/, '')}`
}

export function buildTrakteerUrl(usernameOrUrl: string): string {
  const clean = (usernameOrUrl || '').trim()
  if (!clean) return 'https://trakteer.id/fanx0'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  return `https://trakteer.id/${clean.replace(/^@/, '')}`
}

export function buildGithubRepoUrl(repo: string): string {
  const clean = (repo || '').trim()
  if (!clean) return 'https://github.com/FanX0/felo'
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  return `https://github.com/${clean.replace(/^\//, '')}`
}

export function buildSolscanUrl(address: string): string {
  const clean = (address || '').trim()
  if (!clean) return 'https://solscan.io'
  return `https://solscan.io/account/${clean}`
}

export function useSupportConfig() {
  const [config, setConfig] = useState<SupportConfig>(DEFAULT_SUPPORT_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    let mounted = true

    const loadConfig = async () => {
      try {
        const saved = await window.api?.getSetting?.(SUPPORT_CONFIG_SETTING)
        if (mounted && saved && typeof saved === 'object') {
          setConfig({
            saweriaUsername:
              typeof saved.saweriaUsername === 'string' && saved.saweriaUsername.trim()
                ? saved.saweriaUsername.trim()
                : DEFAULT_SUPPORT_CONFIG.saweriaUsername,
            trakteerUsername:
              typeof saved.trakteerUsername === 'string' && saved.trakteerUsername.trim()
                ? saved.trakteerUsername.trim()
                : DEFAULT_SUPPORT_CONFIG.trakteerUsername,
            solanaAddress:
              typeof saved.solanaAddress === 'string' && saved.solanaAddress.trim()
                ? saved.solanaAddress.trim()
                : DEFAULT_SUPPORT_CONFIG.solanaAddress,
            githubRepo:
              typeof saved.githubRepo === 'string' && saved.githubRepo.trim()
                ? saved.githubRepo.trim()
                : DEFAULT_SUPPORT_CONFIG.githubRepo
          })
        }
      } catch (err) {
        console.warn('Failed to load support configuration:', err)
      } finally {
        if (mounted) setIsLoaded(true)
      }
    }

    void loadConfig()

    const handleConfigUpdated = () => {
      void loadConfig()
    }

    window.addEventListener('felo:support-config-updated', handleConfigUpdated)
    return () => {
      mounted = false
      window.removeEventListener('felo:support-config-updated', handleConfigUpdated)
    }
  }, [])

  const updateConfig = async (partial: Partial<SupportConfig>) => {
    const nextConfig = { ...config, ...partial }
    setConfig(nextConfig)

    try {
      await window.api?.setSetting?.(SUPPORT_CONFIG_SETTING, nextConfig)
      window.dispatchEvent(new CustomEvent('felo:support-config-updated'))
    } catch (err) {
      console.error('Failed to persist support config:', err)
    }
  }

  return { config, updateConfig, isLoaded }
}
