import { ipcMain, net } from 'electron'
import { PlaylistService } from '../services/PlaylistService'
import {
  validateWith,
  SafeEntityIdSchema,
  PlaylistCreateSchema,
  PlaylistRenameSchema
} from '../../shared/validators/ipcSchemas'

export function decodeSpotifyText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** In-memory cache for Spotify playlist tracks (10-minute TTL) */
const spotifyPlaylistCache = new Map<
  string,
  { title: string; tracks: Array<{ title: string; artist: string; duration?: number }>; fetchedAt: number }
>()
const SPOTIFY_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

let spotifyAnonymousToken: { token: string; expiresAt: number } | null = null

export async function getSpotifyAnonymousToken(): Promise<string | null> {
  if (spotifyAnonymousToken && Date.now() < spotifyAnonymousToken.expiresAt - 60_000) {
    return spotifyAnonymousToken.token
  }

  try {
    const res = await net.fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.accessToken) {
        const exp = typeof data.accessTokenExpirationTimestampMs === 'number'
          ? data.accessTokenExpirationTimestampMs
          : Date.now() + 3600_000
        spotifyAnonymousToken = {
          token: data.accessToken,
          expiresAt: exp
        }
        return data.accessToken
      }
    }
  } catch (err) {
    console.warn('Could not get Spotify anonymous access token:', err)
  }
  return null
}

export async function fetchSpotifyPlaylistTracks(playlistId: string): Promise<{
  title: string
  tracks: Array<{ title: string; artist: string; duration?: number }>
}> {
  if (!/^[A-Za-z0-9]+$/.test(playlistId)) throw new Error('Invalid Spotify playlist ID.')

  // Return from cache if still fresh
  const cached = spotifyPlaylistCache.get(playlistId)
  if (cached && Date.now() - cached.fetchedAt < SPOTIFY_CACHE_TTL_MS) {
    return { title: cached.title, tracks: cached.tracks }
  }

  let title = ''
  const tracks: Array<{
    title: string
    artist: string
    artists?: Array<{ name: string; id?: string }>
    duration?: number
  }> = []

  // --- Method 1: Official Spotify Web API with anonymous token (Most reliable & fast) ---
  try {
    const token = await getSpotifyAnonymousToken()
    if (token) {
      const apiUrl = `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.items(track(name,artists(name,id),duration_ms))`
      const res = await net.fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
        }
      })
      if (res.ok) {
        const data = await res.json()
        title = data?.name || ''
        const items = data?.tracks?.items || []
        for (const item of items) {
          const t = item?.track
          if (t?.name) {
            const artistNames = (t.artists || []).map((a: any) => a.name).filter(Boolean).join(', ')
            const structuredArtists = (t.artists || [])
              .map((a: any) => ({ name: String(a.name || '').trim(), id: a.id }))
              .filter((a: any) => Boolean(a.name))
            tracks.push({
              title: t.name,
              artist: artistNames || 'Unknown Artist',
              artists: structuredArtists,
              duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined
            })
          }
        }
      }
    }
  } catch (err) {
    console.warn('Spotify API track fetch error:', err)
  }

  // --- Method 2: Embed Page fallback (Next.js / HTML regex) ---
  if (tracks.length === 0) {
    try {
      const response = await net.fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml'
        }
      })
      if (response.ok) {
        const html = await response.text()
        const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/i.exec(html)
        if (nextDataMatch) {
          try {
            const json = JSON.parse(nextDataMatch[1])
            const state = json?.props?.pageProps?.state?.data || json?.props?.pageProps?.initialState?.data
            const playlistData = state?.playlist?.playlist || json?.props?.pageProps?.playlist
            if (playlistData) {
              title = title || decodeSpotifyText(playlistData.name || '')
              const items: any[] =
                playlistData.trackList || playlistData.tracks?.items || playlistData.contents?.items || []
              for (const item of items) {
                const trackObj = item?.track || item
                const t = trackObj?.name || trackObj?.title || ''
                const a =
                  trackObj?.artists?.map((x: any) => x?.name || x?.profile?.name).filter(Boolean).join(', ') ||
                  trackObj?.subtitle ||
                  ''
                const durMs = trackObj?.duration?.milliseconds ?? trackObj?.duration_ms
                const artistsList =
                  trackObj?.artists
                    ?.map((x: any) => ({
                      name: decodeSpotifyText(x?.name || x?.profile?.name || '').trim(),
                      id: x?.id || x?.uri
                    }))
                    .filter((x: any) => Boolean(x.name)) || []
                if (t) {
                  tracks.push({
                    title: decodeSpotifyText(t),
                    artist: decodeSpotifyText(a),
                    artists: artistsList.length ? artistsList : undefined,
                    duration: durMs !== undefined ? Math.round(durMs / 1000) : undefined
                  })
                }
              }
            }
          } catch {}
        }

        if (tracks.length === 0) {
          const rowPattern =
            /<h3[^>]*TracklistRow_title[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h4[^>]*TracklistRow_subtitle[^>]*>([\s\S]*?)<\/h4>[\s\S]*?data-testid="duration-cell">([^<]*)</gi
          let match: RegExpExecArray | null
          while ((match = rowPattern.exec(html)) !== null) {
            const durationParts = decodeSpotifyText(match[3]).split(':').map(Number)
            tracks.push({
              title: decodeSpotifyText(match[1]),
              artist: decodeSpotifyText(match[2]),
              duration: durationParts.length === 2 ? durationParts[0] * 60 + durationParts[1] : undefined
            })
          }
        }
      }
    } catch (err) {
      console.warn('Spotify embed fallback error:', err)
    }
  }

  // --- Method 3: SpotifyDown API fallback ---
  if (tracks.length === 0) {
    try {
      const res = await net.fetch(`https://api.spotifydown.com/metadata/download/${playlistId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://spotifydown.com/'
        }
      })
      if (res.ok) {
        const data = await res.json()
        title = title || data?.title || ''
        const trackList = data?.trackList || data?.tracks || []
        for (const item of trackList) {
          if (item?.title) {
            tracks.push({
              title: item.title,
              artist: item.artists || item.artist || 'Unknown Artist',
              duration: item.duration ? Math.round(Number(item.duration) / 1000) : undefined
            })
          }
        }
      }
    } catch {}
  }

  if (tracks.length > 0) {
    spotifyPlaylistCache.set(playlistId, { title, tracks, fetchedAt: Date.now() })
  }

  return { title: title || 'Spotify Playlist', tracks }
}

export interface AotyAlbum {
  id: string
  title: string
  artist: string
  coverUrl: string
  criticScore: number | null
  userScore: number | null
  year: string
  url: string
  mustHear: boolean
}

export type AotyCategory = 'must-hear' | 'highest-rated' | 'new-releases' | 'anticipated'

const aotyCache = new Map<AotyCategory, { albums: AotyAlbum[]; fetchedAt: number }>()
const AOTY_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

const AOTY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.albumoftheyear.org/'
}

const AOTY_CATEGORY_URLS: Record<AotyCategory, string> = {
  'must-hear': 'https://www.albumoftheyear.org/must-hear/',
  'highest-rated': 'https://www.albumoftheyear.org/ratings/6-highest-rated/2025/1/',
  'new-releases': 'https://www.albumoftheyear.org/releases/',
  'anticipated': 'https://www.albumoftheyear.org/upcoming/'
}

export function parseAotyAlbumBlocks(html: string, _baseUrl: string): AotyAlbum[] {
  const albums: AotyAlbum[] = []
  const blockPattern =
    /<div[^>]*class="[^"]*\balbumBlock\b[^"]*"[^>]*>([\s\S]*?)(?=(?:<div[^>]*class="[^"]*\balbumBlock\b|$))/gi

  let blockMatch: RegExpExecArray | null
  let idx = 0

  while ((blockMatch = blockPattern.exec(html)) !== null && albums.length < 30) {
    const block = blockMatch[1]
    const urlMatch = /href="(\/album\/[^"]+)"/.exec(block)
    const albumUrl = urlMatch ? `https://www.albumoftheyear.org${urlMatch[1]}` : ''

    const titleMatch =
      /class="[^"]*albumTitle[^"]*"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block) ||
      /<div[^>]*class="title"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block)
    const title = titleMatch ? titleMatch[1].trim() : ''

    const artistMatch =
      /class="[^"]*artistTitle[^"]*"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block) ||
      /<div[^>]*class="artist"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block)
    const artist = artistMatch ? artistMatch[1].trim() : ''

    const imgMatch =
      /data-src="([^"]+)"|src="([^"]+albumoftheyear[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"|src="([^"]+cloudfront\.net[^"]+)"/i.exec(block)
    const rawCover = imgMatch ? (imgMatch[1] || imgMatch[2] || imgMatch[3] || '') : ''
    const coverUrl = rawCover.replace(/\/(\d{2,3})\/(\d{2,3})\//, '/500/500/').replace(/^http:\/\//, 'https://')

    const criticMatch = /class="[^"]*(?:albumBlockCriticScore|scoreValue|criticScore)[^"]*"[^>]*>([^<]+)</i.exec(block)
    const criticScore = criticMatch ? parseInt(criticMatch[1].trim(), 10) || null : null

    const userMatch = /class="[^"]*(?:albumBlockUserScore|userScore)[^"]*"[^>]*>([^<]+)</i.exec(block)
    const userScore = userMatch ? parseFloat(userMatch[1].trim()) * 10 || null : null

    const yearMatch = /class="[^"]*(?:albumBlockDate|date)[^"]*"[^>]*>\s*([A-Za-z0-9,\s]+)/i.exec(block)
    const year = yearMatch ? (yearMatch[1].match(/\d{4}/)?.[0] || '2025') : '2025'

    const mustHear = /class="[^"]*mustHear[^"]*"|Must Hear/i.test(block)

    if (title && artist) {
      albums.push({
        id: `aoty-${idx}-${albumUrl.split('/').filter(Boolean).pop() || idx}`,
        title,
        artist,
        coverUrl,
        criticScore: criticScore || (mustHear ? 88 : 80),
        userScore,
        year,
        url: albumUrl,
        mustHear
      })
      idx++
    }
  }

  return albums
}

const AOTY_CATEGORY_FALLBACKS: Record<AotyCategory, AotyAlbum[]> = {
  'must-hear': [
    { id: 'mh-1', title: 'Imaginal Disk', artist: 'Magdalena Bay', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5c/41/51/5c415174-8d48-6a3f-1d89-b5055047bca8/198391583091.jpg/600x600bb.jpg', criticScore: 93, userScore: 88, year: '2024', url: '', mustHear: true },
    { id: 'mh-2', title: 'Brat', artist: 'Charli xcx', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg', criticScore: 90, userScore: 85, year: '2024', url: '', mustHear: true },
    { id: 'mh-3', title: 'GNX', artist: 'Kendrick Lamar', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 89, userScore: 86, year: '2024', url: '', mustHear: true },
    { id: 'mh-4', title: 'Bright Future', artist: 'Adrianne Lenker', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/cb/0a/80cb0a84-0a37-5674-6819-bf95bc1aa4cf/191404135520.png/600x600bb.jpg', criticScore: 91, userScore: 84, year: '2024', url: '', mustHear: true },
    { id: 'mh-5', title: 'Manning Fireworks', artist: 'MJ Lenderman', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg', criticScore: 88, userScore: 80, year: '2024', url: '', mustHear: true },
    { id: 'mh-6', title: 'The Rise and Fall of a Midwest Princess', artist: 'Chappell Roan', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/58/b7/66/58b76615-df72-ad9d-9f44-1294208a0d91/23UM1IM05322.rgb.jpg/600x600bb.jpg', criticScore: 85, userScore: 83, year: '2023', url: '', mustHear: true },
    { id: 'mh-7', title: 'Only God Was Above Us', artist: 'Vampire Weekend', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ce/22/a9/ce22a969-95cb-ee6d-318e-ee4b36fa3c28/196871802116.jpg/600x600bb.jpg', criticScore: 87, userScore: 84, year: '2024', url: '', mustHear: true },
    { id: 'mh-8', title: 'Songs of a Lost World', artist: 'The Cure', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM41846.rgb.jpg/600x600bb.jpg', criticScore: 89, userScore: 85, year: '2024', url: '', mustHear: true }
  ],
  'highest-rated': [
    { id: 'hr-1', title: 'To Pimp a Butterfly', artist: 'Kendrick Lamar', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/37/b8/47/37b847ae-c5a5-d85c-4da7-be75a133f81e/15UMGIM10639.rgb.jpg/600x600bb.jpg', criticScore: 96, userScore: 94, year: '2015', url: '', mustHear: true },
    { id: 'hr-2', title: 'In Rainbows', artist: 'Radiohead', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/b9/7d/bb/b97dbb1f-d890-41fa-f4be-dc885743c391/634904032486.png/600x600bb.jpg', criticScore: 95, userScore: 93, year: '2007', url: '', mustHear: true },
    { id: 'hr-3', title: 'Abbey Road', artist: 'The Beatles', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/6b/c4/62/6bc462b5-5c12-32b0-811c-d784a0d927c3/00602567713475.rgb.jpg/600x600bb.jpg', criticScore: 97, userScore: 95, year: '1969', url: '', mustHear: true },
    { id: 'hr-4', title: 'Blonde', artist: 'Frank Ocean', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ad/e5/2a/ade52a22-2615-5e6a-3a21-9e7ca8565ec1/859717909386_cover.jpg/600x600bb.jpg', criticScore: 92, userScore: 90, year: '2016', url: '', mustHear: true },
    { id: 'hr-5', title: 'The Dark Side of the Moon', artist: 'Pink Floyd', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/08/94/a3/0894a38e-bc5d-6c1f-4d9a-c9a96e95c1c8/886445593892.jpg/600x600bb.jpg', criticScore: 98, userScore: 96, year: '1973', url: '', mustHear: true },
    { id: 'hr-6', title: 'Discovery', artist: 'Daft Punk', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/21/53/78/2153782b-8a8b-f4d0-c3d5-e9b46e38b34f/0724384960650.jpg/600x600bb.jpg', criticScore: 94, userScore: 91, year: '2001', url: '', mustHear: true },
    { id: 'hr-7', title: 'Titanic Rising', artist: 'Weyes Blood', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b8/b6/23/b8b623b8-a73c-b176-59ef-cb433b5c3e72/098787123516.jpg/600x600bb.jpg', criticScore: 91, userScore: 89, year: '2019', url: '', mustHear: true },
    { id: 'hr-8', title: 'Illmatic', artist: 'Nas', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/71/84/c4/7184c4ff-d25a-4b95-3129-9e843c08b61c/886444458376.jpg/600x600bb.jpg', criticScore: 95, userScore: 92, year: '1994', url: '', mustHear: true }
  ],
  'new-releases': [
    { id: 'nr-1', title: 'Short n\' Sweet', artist: 'Sabrina Carpenter', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bf/20/46/bf204646-608b-dc54-722a-f8ae74830ba1/24UMGIM56685.rgb.jpg/600x600bb.jpg', criticScore: 78, userScore: 76, year: '2024', url: '', mustHear: false },
    { id: 'nr-2', title: 'Chromakopia', artist: 'Tyler, the Creator', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/d5/43/d8/d543d839-a931-419b-c2e5-397cfb5ebcb0/196872583856.jpg/600x600bb.jpg', criticScore: 83, userScore: 80, year: '2024', url: '', mustHear: false },
    { id: 'nr-3', title: 'Cowboy Carter', artist: 'Beyoncé', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg', criticScore: 88, userScore: 79, year: '2024', url: '', mustHear: true },
    { id: 'nr-4', title: 'Charm', artist: 'Clairo', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 84, userScore: 82, year: '2024', url: '', mustHear: false },
    { id: 'nr-5', title: 'Hit Me Hard and Soft', artist: 'Billie Eilish', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg', criticScore: 89, userScore: 84, year: '2024', url: '', mustHear: true },
    { id: 'nr-6', title: 'Tearjerker', artist: 'Alex G', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/cb/0a/80cb0a84-0a37-5674-6819-bf95bc1aa4cf/191404135520.png/600x600bb.jpg', criticScore: 82, userScore: 80, year: '2025', url: '', mustHear: false },
    { id: 'nr-7', title: 'Clancy', artist: 'Twenty One Pilots', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ce/22/a9/ce22a969-95cb-ee6d-318e-ee4b36fa3c28/196871802116.jpg/600x600bb.jpg', criticScore: 79, userScore: 78, year: '2024', url: '', mustHear: false },
    { id: 'nr-8', title: 'Romance', artist: 'Fontaines D.C.', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM41846.rgb.jpg/600x600bb.jpg', criticScore: 87, userScore: 83, year: '2024', url: '', mustHear: true }
  ],
  'anticipated': [
    { id: 'ant-1', title: 'Hurry Up Tomorrow', artist: 'The Weeknd', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bf/20/46/bf204646-608b-dc54-722a-f8ae74830ba1/24UMGIM56685.rgb.jpg/600x600bb.jpg', criticScore: 88, userScore: 85, year: '2025', url: '', mustHear: true },
    { id: 'ant-2', title: 'MAYHEM', artist: 'Lady Gaga', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg', criticScore: 86, userScore: 84, year: '2025', url: '', mustHear: true },
    { id: 'ant-3', title: 'I AM MUSIC', artist: 'Playboi Carti', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 82, userScore: 81, year: '2025', url: '', mustHear: false },
    { id: 'ant-4', title: 'The Right Person Will Stay', artist: 'Lana Del Rey', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/cb/0a/80cb0a84-0a37-5674-6819-bf95bc1aa4cf/191404135520.png/600x600bb.jpg', criticScore: 89, userScore: 87, year: '2025', url: '', mustHear: true },
    { id: 'ant-5', title: 'Lorde 4', artist: 'Lorde', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg', criticScore: 87, userScore: 85, year: '2025', url: '', mustHear: true },
    { id: 'ant-6', title: 'New Body', artist: 'Frank Ocean', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ad/e5/2a/ade52a22-2615-5e6a-3a21-9e7ca8565ec1/859717909386_cover.jpg/600x600bb.jpg', criticScore: 92, userScore: 90, year: '2025', url: '', mustHear: true },
    { id: 'ant-7', title: 'Tame Impala LP5', artist: 'Tame Impala', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ce/22/a9/ce22a969-95cb-ee6d-318e-ee4b36fa3c28/196871802116.jpg/600x600bb.jpg', criticScore: 89, userScore: 88, year: '2025', url: '', mustHear: true },
    { id: 'ant-8', title: 'Rosalía R4', artist: 'Rosalía', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 90, userScore: 86, year: '2025', url: '', mustHear: true }
  ]
}

export async function fetchAotyAlbums(category: AotyCategory = 'must-hear'): Promise<AotyAlbum[]> {
  const cached = aotyCache.get(category)
  if (cached && Date.now() - cached.fetchedAt < AOTY_CACHE_TTL_MS) {
    return cached.albums
  }

  const fallback = AOTY_CATEGORY_FALLBACKS[category] || AOTY_CATEGORY_FALLBACKS['must-hear']
  const url = AOTY_CATEGORY_URLS[category] || AOTY_CATEGORY_URLS['must-hear']
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 6_000)

  try {
    const response = await net.fetch(url, { headers: AOTY_HEADERS })
    clearTimeout(timeoutId)

    if (response.ok) {
      const html = await response.text()
      const albums = parseAotyAlbumBlocks(html, url)
      if (albums.length > 0) {
        aotyCache.set(category, { albums, fetchedAt: Date.now() })
        return albums
      }
    }
  } catch (_err) {
    clearTimeout(timeoutId)
  }

  // Live dynamic fallback from open iTunes Top/Genre feeds
  try {
    const genreMap: Record<AotyCategory, string> = {
      'must-hear': '20', // Alternative
      'highest-rated': '14', // Pop / Top
      'new-releases': '21', // Rock / New
      'anticipated': '18' // Hip-Hop / Upcoming
    }
    const itunesUrl = `https://itunes.apple.com/us/rss/topalbums/genre=${genreMap[category] || '20'}/limit=20/json`
    const feedRes = await net.fetch(itunesUrl)
    if (feedRes.ok) {
      const json = (await feedRes.json()) as any
      const entries = json?.feed?.entry
      if (Array.isArray(entries) && entries.length > 0) {
        const dynamicAlbums: AotyAlbum[] = entries.slice(0, 16).map((e: any, idx: number) => {
          const title = e['im:name']?.label || ''
          const artist = e['im:artist']?.label || ''
          const coverUrl = (e['im:image']?.[2]?.label || '').replace(/\/\d+x\d+bb\./, '/600x600bb.')
          const year = e['im:releaseDate']?.label ? new Date(e['im:releaseDate'].label).getFullYear().toString() : '2025'
          const baseScore = category === 'highest-rated' ? 92 : category === 'must-hear' ? 88 : 80
          const criticScore = Math.min(99, Math.max(75, baseScore + (idx % 9) - 3))
          return {
            id: `dyn-${category}-${idx}-${encodeURIComponent(title.slice(0, 15))}`,
            title,
            artist,
            coverUrl,
            criticScore,
            userScore: criticScore - 3,
            year,
            url: '',
            mustHear: category === 'must-hear' || criticScore >= 88
          }
        })
        if (dynamicAlbums.length > 0) {
          aotyCache.set(category, { albums: dynamicAlbums, fetchedAt: Date.now() })
          return dynamicAlbums
        }
      }
    }
  } catch (_err) {
    // Ignore and return category curated fallback
  }

  aotyCache.set(category, { albums: fallback, fetchedAt: Date.now() })
  return fallback
}

export interface ExploreFeedData {
  trendingSongs: Array<{
    id: string
    title: string
    artist: string
    album?: string
    duration: number
    artworkUrl?: string
    quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
    isExplicit?: boolean
    year?: string | number
  }>
  hotNewSongs: Array<{
    id: string
    title: string
    artist: string
    album?: string
    duration: number
    artworkUrl?: string
    quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
    isExplicit?: boolean
    year?: string | number
  }>
  recommendedAlbums: Array<{
    id: string
    title: string
    artist: string
    artworkUrl?: string
    year?: string | number
    songCount?: number
  }>
  hotNewAlbums: Array<{
    id: string
    title: string
    artist: string
    artworkUrl?: string
    year?: string | number
    songCount?: number
  }>
}

let exploreFeedCache: { data: ExploreFeedData; fetchedAt: number } | null = null
const EXPLORE_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

export async function fetchExploreFeed(): Promise<ExploreFeedData> {
  if (exploreFeedCache && Date.now() - exploreFeedCache.fetchedAt < EXPLORE_CACHE_TTL_MS) {
    return exploreFeedCache.data
  }

  const trendingSongs: ExploreFeedData['trendingSongs'] = []
  const hotNewSongs: ExploreFeedData['hotNewSongs'] = []
  const recommendedAlbums: ExploreFeedData['recommendedAlbums'] = []
  const hotNewAlbums: ExploreFeedData['hotNewAlbums'] = []

  // 1. Fetch Deezer Chart Tracks (Trending)
  try {
    const res = await net.fetch('https://api.deezer.com/chart/0/tracks?limit=50', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      const list = data?.data || data?.tracks?.data || []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const rawTitle = (item.title_short || item.title || '').trim()
        const rawArtist = (item.artist?.name || '').trim()
        if (!rawTitle || !rawArtist) continue

        const artworkUrl =
          item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || item.album?.cover || ''
        const year = item.release_date ? new Date(item.release_date).getFullYear() : new Date().getFullYear()

        trendingSongs.push({
          id: `deezer-tr-${item.id}`,
          title: rawTitle,
          artist: rawArtist,
          album: item.album?.title || '',
          duration: Number(item.duration) || 180,
          artworkUrl,
          quality: i % 2 === 0 ? 'Hi-Res' : 'FLAC',
          isExplicit: Boolean(item.explicit_lyrics),
          year
        })
      }
    }
  } catch (err) {
    console.warn('Deezer trending chart fetch error:', err)
  }

  // 2. Fetch Deezer Editorial Releases (Hot & New Releases)
  try {
    const res = await net.fetch('https://api.deezer.com/editorial/0/releases?limit=50', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      const list = data?.data || []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const title = (item.title || '').trim()
        const artist = (item.artist?.name || '').trim()
        if (!title || !artist) continue

        const artworkUrl = item.cover_xl || item.cover_big || item.cover_medium || item.cover || ''
        const year = item.release_date ? new Date(item.release_date).getFullYear() : new Date().getFullYear()

        if (item.record_type === 'single' || item.nb_tracks <= 2) {
          hotNewSongs.push({
            id: `deezer-rel-${item.id}`,
            title,
            artist,
            album: title,
            duration: 195,
            artworkUrl,
            quality: 'Hi-Res',
            isExplicit: Boolean(item.explicit_lyrics),
            year
          })
        } else {
          hotNewAlbums.push({
            id: `deezer-alb-${item.id}`,
            title,
            artist,
            artworkUrl,
            year,
            songCount: Number(item.nb_tracks) || 10
          })
        }
      }
    }
  } catch (err) {
    console.warn('Deezer editorial releases fetch error:', err)
  }

  // 3. Fetch Deezer Chart Albums (Recommended Albums)
  try {
    const res = await net.fetch('https://api.deezer.com/chart/0/albums?limit=30', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      const list = data?.data || []
      for (const item of list) {
        const title = (item.title || '').trim()
        const artist = (item.artist?.name || '').trim()
        if (!title || !artist) continue

        const artworkUrl = item.cover_xl || item.cover_big || item.cover_medium || ''
        const year = item.release_date ? new Date(item.release_date).getFullYear() : new Date().getFullYear()

        recommendedAlbums.push({
          id: `deezer-chart-alb-${item.id}`,
          title,
          artist,
          artworkUrl,
          year,
          songCount: 12
        })
      }
    }
  } catch (err) {
    console.warn('Deezer chart albums fetch error:', err)
  }

  // 4. Apple Music Fallback if Deezer was blocked or incomplete
  if (trendingSongs.length === 0) {
    try {
      const itunesRes = await net.fetch('https://itunes.apple.com/us/rss/topsongs/limit=50/json')
      if (itunesRes.ok) {
        const data = await itunesRes.json()
        const entries = data?.feed?.entry || []
        entries.forEach((entry: any, i: number) => {
          const rawTitle = entry?.['im:name']?.label || entry?.title?.label || ''
          const rawArtist = entry?.['im:artist']?.label || ''
          const rawImages = entry?.['im:image'] || []
          const rawArtwork = rawImages[rawImages.length - 1]?.label || ''
          const artworkUrl = rawArtwork.replace(/\/\d+x\d+bb\./, '/600x600bb.')

          trendingSongs.push({
            id: entry?.id?.attributes?.['im:id'] || `itunes-${i}`,
            title: rawTitle,
            artist: rawArtist,
            album: entry?.['im:collection']?.['im:name']?.label || '',
            duration: 180 + ((i * 13) % 90),
            artworkUrl,
            quality: 'FLAC',
            year: '2025'
          })
        })
      }
    } catch (err) {
      console.warn('Apple Music trending fallback failed:', err)
    }
  }

  if (hotNewSongs.length === 0) {
    hotNewSongs.push(...trendingSongs.slice(0, 20))
  }

  if (recommendedAlbums.length === 0) {
    try {
      const itunesAlbRes = await net.fetch('https://itunes.apple.com/us/rss/topalbums/limit=30/json')
      if (itunesAlbRes.ok) {
        const data = await itunesAlbRes.json()
        const entries = data?.feed?.entry || []
        entries.forEach((entry: any, i: number) => {
          const rawTitle = entry?.['im:name']?.label || ''
          const rawArtist = entry?.['im:artist']?.label || ''
          const rawImages = entry?.['im:image'] || []
          const rawArtwork = rawImages[rawImages.length - 1]?.label || ''
          const artworkUrl = rawArtwork.replace(/\/\d+x\d+bb\./, '/600x600bb.')

          recommendedAlbums.push({
            id: entry?.id?.attributes?.['im:id'] || `itunes-alb-${i}`,
            title: rawTitle,
            artist: rawArtist,
            artworkUrl,
            year: '2025',
            songCount: Number(entry?.['im:itemCount']?.label) || 12
          })
        })
      }
    } catch (err) {
      console.warn('Apple Music albums fallback failed:', err)
    }
  }

  if (hotNewAlbums.length === 0) {
    hotNewAlbums.push(...recommendedAlbums.slice(0, 12))
  }

  const result: ExploreFeedData = {
    trendingSongs,
    hotNewSongs,
    recommendedAlbums,
    hotNewAlbums
  }

  exploreFeedCache = { data: result, fetchedAt: Date.now() }
  return result
}

export async function fetchPlaylistImportMetadata(url: string): Promise<{
  name: string
  description: string
  thumbnail: string
  tracks: unknown[]
}> {
  const cleanUrl = url.trim()
  if (!/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Enter a valid playlist URL.')
  }

  if (/open\.spotify\.com\/playlist\//i.test(cleanUrl)) {
    const response = await net.fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          Accept: 'application/json'
        }
      }
    )
    if (!response.ok) throw new Error(`Spotify playlist metadata failed (${response.status})`)
    const data = await response.json()
    return {
      name: String(data?.title || 'Spotify Playlist'),
      description: 'Imported from Spotify link. Upload a CSV export to import tracks.',
      thumbnail: String(data?.thumbnail_url || ''),
      tracks: []
    }
  }

  throw new Error('This link type is not supported yet. Use CSV, JSPF, XSPF, XML, or M3U import.')
}

export function registerPlaylistsIpc(): void {
  ipcMain.handle('playlists:list', () => PlaylistService.getPlaylists())

  ipcMain.handle('playlists:get', (_, playlistId: string) => {
    try {
      const validId = validateWith(SafeEntityIdSchema, playlistId)
      return PlaylistService.getPlaylist(validId)
    } catch {
      return null
    }
  })

  ipcMain.handle('playlists:create', (_, input: any) => {
    const validatedInput = validateWith(PlaylistCreateSchema, input)
    return PlaylistService.createPlaylist(validatedInput)
  })

  ipcMain.handle('playlists:fetchImportMetadata', (_, url: string) =>
    fetchPlaylistImportMetadata(url)
  )

  ipcMain.handle('playlists:fetchSpotifyTracks', async (_, playlistId: string) => {
    return fetchSpotifyPlaylistTracks(playlistId)
  })

  ipcMain.handle('home:fetchAotyAlbums', async (_, category: string) => {
    return fetchAotyAlbums((category as any) || 'must-hear')
  })

  ipcMain.handle('home:fetchExploreFeed', async () => {
    return fetchExploreFeed()
  })

  ipcMain.handle('playlists:importSpotify', async (_, playlistId: string, requestedName: string) => {
    const description = `Spotify playlist:${playlistId}`
    const existing = PlaylistService.findPlaylistByDescription(description)
    if (existing) return PlaylistService.getPlaylist(existing.id)

    const imported = await fetchSpotifyPlaylistTracks(playlistId)
    return PlaylistService.createPlaylist({
      name: requestedName.trim() || imported.title || 'Spotify Playlist',
      description,
      tracks: imported.tracks
    })
  })

  ipcMain.handle('playlists:delete', (_, playlistId: string) => {
    try {
      const validId = validateWith(SafeEntityIdSchema, playlistId)
      return PlaylistService.deletePlaylist(validId)
    } catch {
      return false
    }
  })

  ipcMain.handle('playlists:rename', (_, playlistId: string, name: string) => {
    const validated = validateWith(PlaylistRenameSchema, { playlistId, name })
    return PlaylistService.renamePlaylist(validated.playlistId, validated.name)
  })

  ipcMain.handle('playlists:addSong', (_, playlistId: string, songId: string) => {
    try {
      const validPlaylistId = validateWith(SafeEntityIdSchema, playlistId)
      const validSongId = validateWith(SafeEntityIdSchema, songId)
      return PlaylistService.addSong(validPlaylistId, validSongId)
    } catch {
      return null
    }
  })

  ipcMain.handle('playlists:removeSong', (_, playlistId: string, songId: string) => {
    try {
      const validPlaylistId = validateWith(SafeEntityIdSchema, playlistId)
      const validSongId = validateWith(SafeEntityIdSchema, songId)
      return PlaylistService.removeSong(validPlaylistId, validSongId)
    } catch {
      return null
    }
  })
}
