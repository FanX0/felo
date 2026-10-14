/**
 * Shared song matching and provider scoring utilities.
 * Used by both Electron main process (DownloadService) and Vite renderer.
 */
export declare const UNWANTED_VERSION_KEYWORDS: string[];
/**
 * Regex matching source platform tags inside parentheses, brackets, or braces.
 * Handles variations like: (YouTube), [YouTube], (YouTube Music), (Qobuz), [Qobuz],
 * (Qobus), [Qobus], (Deezer), (Soulseek), [Tidal], (Spotify), (SoundCloud), (Apple Music).
 */
export declare const SOURCE_TAG_REGEX: RegExp;
/**
 * Regex matching video or promotional noise tags.
 * Preserves musical tags like (Live), (Remix), (Acoustic), (Extended Mix), (feat. X).
 */
export declare const VIDEO_PROMO_TAG_REGEX: RegExp;
/**
 * Regex matching remaster/release year junk tags like [2021 Remaster], (Remastered), etc.
 */
export declare const REMASTER_TAG_REGEX: RegExp;
/**
 * Trailing noise at the end of a title string (without brackets).
 */
export declare const TRAILING_VIDEO_NOISE_REGEX: RegExp;
/**
 * Channel noise suffixes commonly found in YouTube owner names or metadata.
 * e.g. "Coldplay - Topic", "ColdplayVEVO", "Ed Sheeran Official", "Marshmello Music"
 */
export declare const YOUTUBE_CHANNEL_SUFFIX_REGEX: RegExp;
/**
 * Provider-specific dummy album names that should not be used as actual album titles.
 */
export declare const DUMMY_PROVIDER_ALBUMS: Set<string>;
/**
 * Normalizes text to standard Title Case if it is detected as all-uppercase or all-lowercase.
 * Preserves recognized acronyms (VIP, DJ, EP, Roman numerals).
 */
export declare function normalizeTitleCase(input: string): string;
export interface TrackMetadata {
    title: string;
    artist: string;
    album?: string;
}
/**
 * Sanitizes and normalizes track metadata (title, artist, album) to industry standards.
 * Strips provider tags like (YouTube), (Qobuz), [Qobus], video promo junk, VEVO suffixes,
 * and splits "Artist - Title" embedded in titles when artist is unknown or redundant.
 */
export declare function sanitizeTrackMetadata(raw: TrackMetadata, _source?: string): TrackMetadata;
/**
 * Strips bracketed and parenthesized junk (e.g. [Official Video 4K], (Lyrics))
 * while carefully preserving version tags like (Live), (Remix), (Acoustic).
 */
export declare function stripJunkTags(text: string): string;
/**
 * Normalizes text for matching while carefully preserving version indicators
 * (e.g. live, remix, acoustic) so they can be accurately compared.
 */
export declare function normalizeForMatching(value?: string): string;
/**
 * Strips noise and formats a high-precision search query for streaming providers.
 */
export declare function cleanSearchQuery(artist?: string, title?: string, fallbackQuery?: string): string;
export interface SmartParsedQuery {
    title: string;
    artist: string;
    cleanQuery: string;
    isCollaboration: boolean;
}
/**
 * Parses user input queries into canonical title, artist, and collaboration metadata.
 * Handles natural connectors like "by", "-", "feat.", "ft.", "&", "with".
 */
export declare function parseSmartQuery(raw: string, explicitArtist?: string): SmartParsedQuery;
/**
 * Parses a Soulseek or local file path into extracted artist, title, and album metadata.
 */
export declare function parseAudioFilePath(rawPath: string): {
    title: string;
    artist: string;
    album: string;
};
/**
 * Calculates normalized Levenshtein similarity between two strings (0.0 to 1.0).
 */
export declare function stringSimilarity(a: string, b: string): number;
export declare function parseDurationToSeconds(duration: string | number | undefined | null): number;
export declare function findMatchingLibrarySong<T extends {
    title?: string;
    artist?: string;
    filePath?: string;
}>(targetTitle: string, targetArtist: string, librarySongs: T[]): T | undefined;
export declare function isSongInLibrary(targetTitle: string, targetArtist: string, librarySongs: Array<{
    title?: string;
    artist?: string;
    filePath?: string;
}>): boolean;
export interface MatchScore {
    score: number;
    confidence: 'Exact match' | 'High match' | 'Provider match' | 'Low match' | 'Mismatched';
    isAcceptable: boolean;
    durationDelta?: number | null;
    isStudioMatch?: boolean;
    rejectReason?: string;
}
export declare function cleanProviderArtist(artist?: string): string;
export declare function scoreProviderMatch(target: {
    title: string;
    artist?: string;
    duration?: number | string | null;
}, candidate: {
    title: string;
    artist?: string;
    meta?: string;
    description?: string;
    duration?: number | string | null;
}): MatchScore;
export declare function validateTrackIdentity(target: {
    title: string;
    artist?: string;
    duration?: number | string | null;
}, candidate: {
    title: string;
    artist?: string;
    meta?: string;
    description?: string;
    duration?: number | string | null;
}): {
    isValid: boolean;
    score: number;
    reason?: string;
};
