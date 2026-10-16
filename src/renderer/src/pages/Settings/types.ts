export interface LibraryRoot {
  id: string
  path: string
  label?: string
  dateAdded: number
  songCount?: number
}

export interface StreamingAccounts {
  qobuzAuthMethod: 'token' | 'password'
  qobuzUser: string
  qobuzSecret: string
  qobuzAppId: string
  qobuzAppSecret: string
  qobuzQuality: string
  deezerArl: string
  deezerQuality: string
  soulseekUser?: string
  soulseekPassword?: string
}

export interface ProviderTestStatus {
  loading: boolean
  success?: boolean
  message?: string
  rawError?: string
}

export interface PresenceStatus {
  installed: boolean
  running: boolean
  configured: boolean
  executablePath: string | null
}

export interface DiscordBinding {
  channel_id: string
  bound_by: string
  updated_at?: string
}

export interface ExternalPlayerClientConfigs {
  apiKey: string
  port: number
  running: boolean
  hermes: string
  claudeDesktop: string
  cursor: string
  windsurf: string
}

export type McpTab = 'claude' | 'hermes' | 'cursor'

export type SettingsCategory =
  | 'all'
  | 'library'
  | 'providers'
  | 'audio'
  | 'integrations'
  | 'appearance'
