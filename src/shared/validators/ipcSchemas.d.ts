import { z } from 'zod';
/**
 * Standardized validation error helper
 */
export declare class ValidationError extends Error {
    issues?: z.ZodIssue[];
    constructor(message: string, issues?: z.ZodIssue[]);
}
/**
 * Validates data against a Zod schema or throws a safe ValidationError.
 */
export declare function validateWith<T>(schema: z.ZodType<T>, data: unknown): T;
/**
 * Whitelist of client-writable settings keys via settings:set.
 * Protected internal keys (felo_remote_control_token, felo_external_playback_api_key, etc.)
 * are strictly forbidden here and can only be managed by their dedicated privileged handlers.
 */
export declare const AllowedSettingsKeySchema: z.ZodEnum<{
    "download.priority": "download.priority";
    "download.playbackStorage": "download.playbackStorage";
    "download.streamCacheLimit": "download.streamCacheLimit";
    "download.location": "download.location";
    "download.streamingAccounts": "download.streamingAccounts";
    "search.lastFmApiKey": "search.lastFmApiKey";
    theme: "theme";
    "audio.outputDevice": "audio.outputDevice";
    "audio.volume": "audio.volume";
}>;
export type AllowedSettingsKey = z.infer<typeof AllowedSettingsKeySchema>;
export declare const DownloadLocationSchema: z.ZodString;
export declare const StreamingAccountsSchema: z.ZodObject<{
    qobuzAuthMethod: z.ZodOptional<z.ZodEnum<{
        token: "token";
        password: "password";
    }>>;
    qobuzUser: z.ZodOptional<z.ZodString>;
    qobuzSecret: z.ZodOptional<z.ZodString>;
    qobuzAppId: z.ZodOptional<z.ZodString>;
    qobuzAppSecret: z.ZodOptional<z.ZodString>;
    qobuzQuality: z.ZodOptional<z.ZodString>;
    deezerArl: z.ZodOptional<z.ZodString>;
    deezerQuality: z.ZodOptional<z.ZodString>;
    soulseekUser: z.ZodOptional<z.ZodString>;
    soulseekPassword: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const SettingValueSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodString>, z.ZodObject<{
    qobuzAuthMethod: z.ZodOptional<z.ZodEnum<{
        token: "token";
        password: "password";
    }>>;
    qobuzUser: z.ZodOptional<z.ZodString>;
    qobuzSecret: z.ZodOptional<z.ZodString>;
    qobuzAppId: z.ZodOptional<z.ZodString>;
    qobuzAppSecret: z.ZodOptional<z.ZodString>;
    qobuzQuality: z.ZodOptional<z.ZodString>;
    deezerArl: z.ZodOptional<z.ZodString>;
    deezerQuality: z.ZodOptional<z.ZodString>;
    soulseekUser: z.ZodOptional<z.ZodString>;
    soulseekPassword: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodRecord<z.ZodString, z.ZodUnknown>]>;
export declare const StreamingSourceSchema: z.ZodEnum<{
    qobuz: "qobuz";
    deezer: "deezer";
    soulseek: "soulseek";
    youtube: "youtube";
}>;
/**
 * Strict transfer ID: only safe alphanumeric characters and hyphens/underscores.
 * Prevents directory traversal like ../../evil.
 */
export declare const TransferIdSchema: z.ZodString;
export declare const DownloadConflictModeSchema: z.ZodEnum<{
    replace: "replace";
    keep_both: "keep_both";
}>;
export declare const DownloadStorageModeSchema: z.ZodOptional<z.ZodEnum<{
    stream: "stream";
    download: "download";
}>>;
export declare const StartDownloadRequestSchema: z.ZodObject<{
    transferId: z.ZodString;
    source: z.ZodEnum<{
        qobuz: "qobuz";
        deezer: "deezer";
        soulseek: "soulseek";
        youtube: "youtube";
    }>;
    resultId: z.ZodString;
    title: z.ZodString;
    artist: z.ZodString;
    songId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    conflictMode: z.ZodEnum<{
        replace: "replace";
        keep_both: "keep_both";
    }>;
    accounts: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        qobuzAuthMethod: z.ZodOptional<z.ZodEnum<{
            token: "token";
            password: "password";
        }>>;
        qobuzUser: z.ZodOptional<z.ZodString>;
        qobuzSecret: z.ZodOptional<z.ZodString>;
        qobuzAppId: z.ZodOptional<z.ZodString>;
        qobuzAppSecret: z.ZodOptional<z.ZodString>;
        qobuzQuality: z.ZodOptional<z.ZodString>;
        deezerArl: z.ZodOptional<z.ZodString>;
        deezerQuality: z.ZodOptional<z.ZodString>;
        soulseekUser: z.ZodOptional<z.ZodString>;
        soulseekPassword: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    storageMode: z.ZodOptional<z.ZodEnum<{
        stream: "stream";
        download: "download";
    }>>;
    skipIfExists: z.ZodOptional<z.ZodBoolean>;
    autoPlay: z.ZodOptional<z.ZodBoolean>;
    artworkUrl: z.ZodOptional<z.ZodString>;
    album: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ValidatedStartDownloadRequest = z.infer<typeof StartDownloadRequestSchema>;
export declare const SafeFolderPathSchema: z.ZodString;
export declare const SafeEntityIdSchema: z.ZodString;
export declare const PlaylistCreateSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    songIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tracks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        artist: z.ZodOptional<z.ZodString>;
        album: z.ZodOptional<z.ZodString>;
        duration: z.ZodOptional<z.ZodNumber>;
        matchedSongId: z.ZodOptional<z.ZodString>;
        coverArt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const PlaylistRenameSchema: z.ZodObject<{
    playlistId: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>;
export declare const PlayRecordSchema: z.ZodObject<{
    songId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    artist: z.ZodOptional<z.ZodString>;
    album: z.ZodOptional<z.ZodString>;
    duration: z.ZodOptional<z.ZodNumber>;
    completedPercent: z.ZodOptional<z.ZodNumber>;
    startedAt: z.ZodOptional<z.ZodNumber>;
    endedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/**
 * Enforces strict HTTPS Discord webhook URLs, preventing SSRF against internal hosts or loopback.
 */
export declare const DiscordWebhookUrlSchema: z.ZodString;
export declare const DiscordSettingsSchema: z.ZodObject<{
    token: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    prefix: z.ZodOptional<z.ZodString>;
    channelId: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodLiteral<"">]>>;
    webhookUrl: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodLiteral<"">]>>;
    webhookEnabled: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Whitelist only safe web protocols. Reject dangerous file:, smb:, ms-msdt:, etc.
 */
export declare const SafeExternalUrlSchema: z.ZodString;
export declare const LyricsFetchInputSchema: z.ZodObject<{
    title: z.ZodString;
    artist: z.ZodOptional<z.ZodString>;
    album: z.ZodOptional<z.ZodString>;
    duration: z.ZodOptional<z.ZodNumber>;
    filePath: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
