export interface SongArtist {
    id?: string;
    name: string;
    role?: 'primary' | 'featured';
}
export interface ParsedArtist {
    name: string;
    role: 'primary' | 'featured';
}
/**
 * Generates deterministic MD5 hash ID for an artist name.
 */
export declare function getArtistId(name: string): string;
/**
 * Parses all artists from primary artist string, artists array, and track title.
 * Returns an ordered array where index 0 is primary artist and subsequent entries are co-artists or featured.
 */
export declare function parseArtists(primaryArtist?: string, artistsArray?: string[], trackTitle?: string): ParsedArtist[];
/**
 * Formats multiple artists into a single string for display or legacy compatibility.
 * e.g. "Drake, 21 Savage"
 */
export declare function formatArtistsDisplay(artists: Array<SongArtist | ParsedArtist | string>): string;
