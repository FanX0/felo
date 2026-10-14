// Known band names or entities containing '&', 'and', '+', or commas that should not be split
const PRESERVED_COMPOSITE_ARTISTS = new Set([
    'earth, wind & fire',
    'earth wind & fire',
    'earth, wind and fire',
    'simon & garfunkel',
    'simon and garfunkel',
    'crosby, stills, nash & young',
    'crosby, stills & nash',
    'emerson, lake & palmer',
    'blood, sweat & tears',
    'kool & the gang',
    'huey lewis & the news',
    'hall & oates',
    'daryl hall & john oates',
    'tom petty and the heartbreakers',
    'bob marley & the wailers',
    'florence + the machine',
    'florence and the machine',
    'marina and the diamonds',
    'of monsters and men',
    'king gizzard & the lizard wizard',
    'tyler, the creator',
    'joan jett & the blackhearts',
    'toots & the maytals',
    'kc and the sunshine band',
    'sly & the family stone',
    'peter, paul and mary',
    'frankie lymon & the teenagers',
    'gladys knight & the pips',
    'brooks & dunn',
    'dan + shay',
    'the mamas & the papas',
    'arms and sleepers',
    'above & beyond',
    'ac/dc'
]);
function isPreservedArtist(name) {
    return PRESERVED_COMPOSITE_ARTISTS.has(name.trim().toLowerCase());
}
/**
 * Pure JS MD5 implementation for deterministic artist IDs across main and renderer.
 */
function computeMd5(input) {
    const k = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
        0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
        0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
        0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
        0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
    ];
    const s = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const utf8 = [];
    for (let i = 0; i < input.length; i++) {
        let charcode = input.charCodeAt(i);
        if (charcode < 0x80)
            utf8.push(charcode);
        else if (charcode < 0x800) {
            utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
            utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
        }
        else {
            i++;
            charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
            utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
        }
    }
    const n = utf8.length;
    const bitLen = n * 8;
    const paddedLen = (((n + 8) >>> 6) + 1) << 4;
    const m = new Uint32Array(paddedLen);
    for (let i = 0; i < n; i++)
        m[i >>> 2] |= utf8[i] << ((i % 4) * 8);
    m[n >>> 2] |= 0x80 << ((n % 4) * 8);
    m[paddedLen - 2] = bitLen & 0xffffffff;
    m[paddedLen - 1] = Math.floor(bitLen / 0x100000000);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let i = 0; i < paddedLen; i += 16) {
        let a = a0, B = b0, c = c0, d = d0;
        for (let j = 0; j < 64; j++) {
            let f, g;
            if (j < 16) {
                f = (B & c) | (~B & d);
                g = j;
            }
            else if (j < 32) {
                f = (d & B) | (~d & c);
                g = (5 * j + 1) % 16;
            }
            else if (j < 48) {
                f = B ^ c ^ d;
                g = (3 * j + 5) % 16;
            }
            else {
                f = c ^ (B | ~d);
                g = (7 * j) % 16;
            }
            const temp = d;
            d = c;
            c = B;
            const sum = (a + f + k[j] + m[i + g]) | 0;
            B = (B + ((sum << s[j]) | (sum >>> (32 - s[j])))) | 0;
            a = temp;
        }
        a0 = (a0 + a) | 0;
        b0 = (b0 + B) | 0;
        c0 = (c0 + c) | 0;
        d0 = (d0 + d) | 0;
    }
    const toHex = (x) => {
        let str = '';
        for (let byte = 0; byte < 4; byte++) {
            const v = (x >>> (byte * 8)) & 0xff;
            str += v.toString(16).padStart(2, '0');
        }
        return str;
    };
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}
/**
 * Generates deterministic MD5 hash ID for an artist name.
 */
export function getArtistId(name) {
    return computeMd5((name || '').trim().toLowerCase());
}
/**
 * Extracts featured artists from track title e.g. "Song Name (feat. Artist B)"
 */
function extractFeaturesFromTitle(title) {
    if (!title)
        return [];
    const features = [];
    const featPatterns = [
        /\((?:feat\.|ft\.|featuring)\s+([^)]+)\)/gi,
        /\[(?:feat\.|ft\.|featuring)\s+([^\]]+)\]/gi,
        /\s+(?:feat\.|ft\.|featuring)\s+([^(\[]+)/gi
    ];
    for (const pattern of featPatterns) {
        let match;
        while ((match = pattern.exec(title)) !== null) {
            if (match[1]) {
                features.push(match[1].trim());
            }
        }
    }
    return features;
}
/**
 * Splits a raw string by common collaboration delimiters:
 * feat., ft., featuring, &, +, x, ×, /, ;, and comma
 */
function splitRawArtistString(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return [];
    if (isPreservedArtist(trimmed))
        return [trimmed];
    // First handle explicit 'feat.' / 'ft.' / 'featuring'
    const featParts = trimmed.split(/\s+(?:feat\.|ft\.|featuring)\s+/i);
    if (featParts.length > 1) {
        const results = [];
        results.push(...splitRawArtistString(featParts[0]));
        for (let i = 1; i < featParts.length; i++) {
            results.push(...splitRawArtistString(featParts[i]));
        }
        return results;
    }
    // Handle slashes, semicolons, or pipes (very common in ID3 tags)
    if (/[;/|]/.test(trimmed)) {
        return trimmed
            .split(/[;/|]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    // Handle " x " or " × " (EDM / pop collaboration style)
    if (/\s+[x×]\s+/i.test(trimmed)) {
        return trimmed
            .split(/\s+[x×]\s+/i)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    // Handle " & " or " and "
    if (/\s+(&|and|\+)\s+/i.test(trimmed)) {
        return trimmed
            .split(/\s+(?:&|and|\+)\s+/i)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    // Handle commas: e.g. "Artist A, Artist B"
    if (trimmed.includes(',')) {
        return trimmed
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [trimmed];
}
/**
 * Parses all artists from primary artist string, artists array, and track title.
 * Returns an ordered array where index 0 is primary artist and subsequent entries are co-artists or featured.
 */
export function parseArtists(primaryArtist, artistsArray, trackTitle) {
    const rawList = [];
    // 1. If explicit artists array is provided by music-metadata or Spotify API
    if (Array.isArray(artistsArray) && artistsArray.length > 0) {
        for (let i = 0; i < artistsArray.length; i++) {
            const item = String(artistsArray[i] || '').trim();
            if (!item)
                continue;
            // If single item has internal delimiters, split it further
            const subItems = splitRawArtistString(item);
            for (let j = 0; j < subItems.length; j++) {
                const sub = subItems[j];
                rawList.push({
                    name: sub,
                    role: i === 0 && j === 0 ? 'primary' : 'featured'
                });
            }
        }
    }
    else if (primaryArtist && primaryArtist.trim()) {
        // 2. Parse from primary artist string
        const split = splitRawArtistString(primaryArtist);
        for (let i = 0; i < split.length; i++) {
            rawList.push({
                name: split[i],
                role: i === 0 ? 'primary' : 'featured'
            });
        }
    }
    // 3. Check track title for featured artists (e.g. "Song (feat. Artist C)")
    if (trackTitle) {
        const titleFeatures = extractFeaturesFromTitle(trackTitle);
        for (const feat of titleFeatures) {
            const splitFeat = splitRawArtistString(feat);
            for (const item of splitFeat) {
                rawList.push({
                    name: item,
                    role: 'featured'
                });
            }
        }
    }
    // 4. Deduplicate while preserving order and roles
    const seen = new Set();
    const result = [];
    for (const item of rawList) {
        const cleanName = item.name.replace(/^["']|["']$/g, '').trim();
        if (!cleanName)
            continue;
        const key = cleanName.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push({
            name: cleanName,
            role: result.length === 0 ? item.role : 'featured'
        });
    }
    if (result.length === 0) {
        const fallback = (primaryArtist || 'Unknown Artist').trim();
        return [{ name: fallback, role: 'primary' }];
    }
    return result;
}
/**
 * Formats multiple artists into a single string for display or legacy compatibility.
 * e.g. "Drake, 21 Savage"
 */
export function formatArtistsDisplay(artists) {
    if (!artists || artists.length === 0)
        return 'Unknown Artist';
    return artists
        .map((a) => (typeof a === 'string' ? a.trim() : a.name.trim()))
        .filter(Boolean)
        .join(', ');
}
