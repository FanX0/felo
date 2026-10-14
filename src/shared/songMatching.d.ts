/**
 * Shared song matching and provider scoring utilities.
 * Used by both Electron main process (DownloadService) and Vite renderer.
 */
export declare const UNWANTED_VERSION_KEYWORDS: string[];
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
