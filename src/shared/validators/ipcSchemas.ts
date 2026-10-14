import { z } from 'zod'

/**
 * Standardized validation error helper
 */
export class ValidationError extends Error {
  constructor(message: string, public issues?: z.ZodIssue[]) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validates data against a Zod schema or throws a safe ValidationError.
 */
export function validateWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const issueSummary = result.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ')
    throw new ValidationError(`Validation failed: ${issueSummary}`, result.error.issues)
  }
  return result.data
}

// ─────────────────────────────────────────────────────────────
// 1. Settings Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Whitelist of client-writable settings keys via settings:set.
 * Protected internal keys (felo_remote_control_token, felo_external_playback_api_key, etc.)
 * are strictly forbidden here and can only be managed by their dedicated privileged handlers.
 */
export const AllowedSettingsKeySchema = z.enum([
  'download.priority',
  'download.playbackStorage',
  'download.streamCacheLimit',
  'download.location',
  'download.streamingAccounts',
  'search.lastFmApiKey',
  'theme',
  'audio.outputDevice',
  'audio.volume'
])

export type AllowedSettingsKey = z.infer<typeof AllowedSettingsKeySchema>

const isSystemRootOrForbidden = (val: string): boolean => {
  const trimmed = val.trim().replace(/\\/g, '/')
  // Forbidden system paths and roots
  if (/^[a-zA-Z]:\/?$/.test(trimmed)) return true // e.g. C:, C:/, C:\
  if (trimmed === '/' || trimmed === '//') return true
  if (/^[a-zA-Z]:\/(windows|system32|program files)/i.test(trimmed)) return true
  if (/^\/(etc|usr|bin|sbin|var|sys|proc|root)/i.test(trimmed)) return true
  return false
}

export const DownloadLocationSchema = z
  .string()
  .max(1024)
  .refine((val) => !val.includes('\0'), { message: 'Path cannot contain null bytes' })
  .refine((val) => val === '' || !isSystemRootOrForbidden(val), {
    message: 'System roots or critical system directories cannot be used as download destination'
  })

export const StreamingAccountsSchema = z
  .object({
    qobuzAuthMethod: z.enum(['token', 'password']).optional(),
    qobuzUser: z.string().max(256).optional(),
    qobuzSecret: z.string().max(512).optional(),
    qobuzAppId: z.string().max(128).optional(),
    qobuzAppSecret: z.string().max(256).optional(),
    qobuzQuality: z.string().max(64).optional(),
    deezerArl: z.string().max(512).optional(),
    deezerQuality: z.string().max(64).optional(),
    soulseekUser: z.string().max(128).optional(),
    soulseekPassword: z.string().max(256).optional()
  })
  .passthrough()

export const SettingValueSchema = z.union([
  z.string().max(8192),
  z.number(),
  z.boolean(),
  z.array(z.string().max(256)).max(50),
  StreamingAccountsSchema,
  z.record(z.string(), z.unknown())
])

// ─────────────────────────────────────────────────────────────
// 2. Download Request Schemas
// ─────────────────────────────────────────────────────────────

export const StreamingSourceSchema = z.enum(['qobuz', 'deezer', 'soulseek', 'youtube'])

/**
 * Strict transfer ID: only safe alphanumeric characters and hyphens/underscores.
 * Prevents directory traversal like ../../evil.
 */
export const TransferIdSchema = z
  .string()
  .min(4)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Transfer ID must be alphanumeric and cannot contain path separators')

export const DownloadConflictModeSchema = z.enum(['replace', 'keep_both'])
export const DownloadStorageModeSchema = z.enum(['stream', 'download']).optional()

export const StartDownloadRequestSchema = z.object({
  transferId: TransferIdSchema,
  source: StreamingSourceSchema,
  resultId: z.string().min(1).max(512),
  title: z.string().min(1).max(300),
  artist: z.string().min(1).max(300),
  songId: z.string().max(128).optional().default(''),
  conflictMode: DownloadConflictModeSchema,
  accounts: StreamingAccountsSchema.optional().default({}),
  storageMode: DownloadStorageModeSchema,
  skipIfExists: z.boolean().optional(),
  autoPlay: z.boolean().optional(),
  artworkUrl: z.string().url().max(2048).optional(),
  album: z.string().max(300).optional()
})

export type ValidatedStartDownloadRequest = z.infer<typeof StartDownloadRequestSchema>

// ─────────────────────────────────────────────────────────────
// 3. Library & Playlist Schemas
// ─────────────────────────────────────────────────────────────

export const SafeFolderPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((val) => !val.includes('\0'), { message: 'Path cannot contain null bytes' })
  .refine((val) => !isSystemRootOrForbidden(val), {
    message: 'System roots or protected system directories cannot be added to library'
  })

export const SafeEntityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_:.-]+$/, 'Invalid entity ID format')

export const PlaylistCreateSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  songIds: z.array(SafeEntityIdSchema).max(5000).optional(),
  tracks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        artist: z.string().max(300).optional(),
        album: z.string().max(300).optional(),
        duration: z.number().nonnegative().optional(),
        matchedSongId: z.string().max(128).optional(),
        coverArt: z.string().max(2048).optional()
      })
    )
    .max(5000)
    .optional()
})

export const PlaylistRenameSchema = z.object({
  playlistId: SafeEntityIdSchema,
  name: z.string().min(1).max(150)
})

// ─────────────────────────────────────────────────────────────
// 4. Playback Ledger & History Schemas
// ─────────────────────────────────────────────────────────────

export const PlayRecordSchema = z.object({
  songId: z.string().min(1).max(128),
  title: z.string().max(300).optional(),
  artist: z.string().max(300).optional(),
  album: z.string().max(300).optional(),
  duration: z.number().nonnegative().optional(),
  completedPercent: z.number().min(0).max(1).optional(),
  startedAt: z.number().int().positive().optional(),
  endedAt: z.number().int().positive().optional()
})

// ─────────────────────────────────────────────────────────────
// 5. Discord Webhook & Bot Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Enforces strict HTTPS Discord webhook URLs, preventing SSRF against internal hosts or loopback.
 */
export const DiscordWebhookUrlSchema = z
  .string()
  .regex(
    /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,21}\/[A-Za-z0-9_-]+$/,
    'Must be a valid HTTPS Discord webhook URL'
  )

export const DiscordSettingsSchema = z.object({
  token: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
  prefix: z.string().min(1).max(10).optional(),
  channelId: z
    .string()
    .regex(/^\d{17,21}$/, 'Invalid Discord channel ID')
    .or(z.literal(''))
    .optional(),
  webhookUrl: DiscordWebhookUrlSchema.or(z.literal('')).optional(),
  webhookEnabled: z.boolean().optional()
})

// ─────────────────────────────────────────────────────────────
// 6. External URL & Open External Protocol Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Whitelist only safe web protocols. Reject dangerous file:, smb:, ms-msdt:, etc.
 */
export const SafeExternalUrlSchema = z
  .string()
  .url()
  .max(4096)
  .refine((url) => /^https?:\/\//i.test(url) || /^mailto:/i.test(url), {
    message: 'Only HTTP, HTTPS, and mailto protocols are permitted for external opening'
  })

// ─────────────────────────────────────────────────────────────
// 7. Lyrics Schema
// ─────────────────────────────────────────────────────────────

export const LyricsFetchInputSchema = z.object({
  title: z.string().min(1).max(300),
  artist: z.string().max(300).optional(),
  album: z.string().max(300).optional(),
  duration: z.number().nonnegative().optional(),
  filePath: z.string().max(1024).optional()
})
