import { describe, it, expect } from 'vitest'
import {
  normalizeForMatching,
  cleanSearchQuery,
  parseAudioFilePath,
  stringSimilarity,
  scoreProviderMatch,
  parseSmartQuery,
  sanitizeTrackMetadata,
  DUMMY_PROVIDER_ALBUMS
} from '../../../src/shared/songMatching'

describe('Shared Core: songMatching', () => {
  describe('normalizeForMatching', () => {
    it('strips junk promotional tags and suffixes while preserving version keywords', () => {
      const normStudio = normalizeForMatching('Radiohead - Creep [Official Music Video 4K]')
      const normLive = normalizeForMatching('Radiohead - Creep (Live in Oxford)')
      const normRemix = normalizeForMatching('Creep (Acoustic Version)')

      expect(normStudio).toBe('radiohead creep')
      expect(normLive).toContain('live')
      expect(normRemix).toContain('acoustic')
    })

    it('strips remaster and release year tags', () => {
      const normRemaster1 = normalizeForMatching('Hotel California [2013 Remaster]')
      const normRemaster2 = normalizeForMatching('Bohemian Rhapsody (Digitally Remastered)')
      expect(normRemaster1).toBe('hotel california')
      expect(normRemaster2).toBe('bohemian rhapsody')
    })

    it('handles unicode accents and diacritics cleanly', () => {
      const norm1 = normalizeForMatching('Beyoncé - Déjà Vu')
      expect(norm1).toBe('beyoncé déjà vu')
    })
  })

  describe('cleanSearchQuery', () => {
    it('produces clean formatted search queries for streaming providers', () => {
      const q1 = cleanSearchQuery('Kendrick Lamar', 'HUMBLE. (Official Video)')
      expect(q1).toBe('Kendrick Lamar HUMBLE.')

      const q2 = cleanSearchQuery('Queen', 'Queen - Bohemian Rhapsody')
      expect(q2).toBe('Queen - Bohemian Rhapsody')

      const q3 = cleanSearchQuery('Daft Punk', '01 - Get Lucky (feat. Pharrell Williams) [HD]')
      expect(q3).toBe('Daft Punk Get Lucky')
    })
  })

  describe('parseAudioFilePath', () => {
    it('extracts artist, album, and title from local and P2P filesystem paths', () => {
      const path1 = 'D:\\Music\\Pink Floyd\\The Dark Side of the Moon\\02 - Time.flac'
      const parsed1 = parseAudioFilePath(path1)
      expect(parsed1.title).toBe('Time')
      expect(parsed1.artist).toBe('Pink Floyd')
      expect(parsed1.album).toBe('The Dark Side of the Moon')

      const path2 = 'C:/Shares/Music/The Beatles - Abbey Road (1969) [FLAC]/01. Come Together.flac'
      const parsed2 = parseAudioFilePath(path2)
      expect(parsed2.title).toBe('Come Together')
      expect(parsed2.artist).toBe('The Beatles')

      const path3 = 'SoulseekShared/Daft Punk - Get Lucky (Radio Edit).mp3'
      const parsed3 = parseAudioFilePath(path3)
      expect(parsed3.artist).toBe('Daft Punk')
      expect(parsed3.title).toBe('Get Lucky (Radio Edit)')
    })
  })

  describe('stringSimilarity', () => {
    it('measures Levenshtein string similarity accurately', () => {
      expect(stringSimilarity('blinding lights', 'blinding lights')).toBe(1)
      expect(stringSimilarity('blinding lights', 'blindng lights')).toBeGreaterThan(0.85)
      expect(stringSimilarity('blinding lights', 'hotel california')).toBeLessThan(0.3)
      expect(stringSimilarity('', '')).toBe(1)
      expect(stringSimilarity('abc', '')).toBe(0)
    })
  })

  describe('scoreProviderMatch', () => {
    it('scores exact studio match with high confidence and acceptable flag', () => {
      const target = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
      const studioCand = {
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        album: 'After Hours',
        duration: 200,
        meta: 'FLAC Lossless'
      }
      const scoreStudio = scoreProviderMatch(target, studioCand)
      expect(scoreStudio.score).toBeGreaterThanOrEqual(95)
      expect(scoreStudio.confidence).toBe('Exact match')
      expect(scoreStudio.isAcceptable).toBe(true)
    })

    it('penalizes live/remix cuts when original studio cut is requested', () => {
      const target = { title: 'Creep', artist: 'Radiohead', duration: 238 }
      const liveCand = {
        title: 'Creep (Live at Reading Festival)',
        artist: 'Radiohead',
        duration: 275,
        meta: 'FLAC Lossless'
      }
      const scoreLive = scoreProviderMatch(target, liveCand)
      expect(scoreLive.score).toBeLessThan(50)
      expect(scoreLive.isAcceptable).toBe(false)
    })

    it('rewards version alignment when target explicitly requests acoustic or live', () => {
      const targetAcoustic = { title: 'Layla (Acoustic)', artist: 'Eric Clapton', duration: 289 }
      const acousticCand = { title: 'Layla (Acoustic Live)', artist: 'Eric Clapton', duration: 289 }
      const electricCand = { title: 'Layla', artist: 'Eric Clapton', duration: 425 }

      const scoreAcoustic = scoreProviderMatch(targetAcoustic, acousticCand)
      const scoreElectric = scoreProviderMatch(targetAcoustic, electricCand)

      expect(scoreAcoustic.score).toBeGreaterThan(scoreElectric.score)
      expect(scoreAcoustic.isAcceptable).toBe(true)
    })

    it('penalizes large duration discrepancies (>30 seconds)', () => {
      const target = { title: 'Stairway to Heaven', artist: 'Led Zeppelin', duration: 482 }
      const shortSnippetCand = { title: 'Stairway to Heaven', artist: 'Led Zeppelin', duration: 120 }

      const result = scoreProviderMatch(target, shortSnippetCand)
      expect(result.score).toBeLessThan(50)
      expect(result.isAcceptable).toBe(false)
    })

    it('accurately scores featured artists and YouTube candidate titles with Artist - Title format', () => {
      const target = { title: 'Raindance (feat. Tems)', artist: 'Dave', duration: 215 }
      const cand = {
        title: 'Dave - Raindance ft Tems (Official Video)',
        artist: 'Dave',
        duration: 215
      }

      const result = scoreProviderMatch(target, cand)
      expect(result.score).toBeGreaterThanOrEqual(85)
      expect(result.isAcceptable).toBe(true)
    })
  })

  describe('parseSmartQuery', () => {
    it('accurately decomposes artist names, connectors, and collaborations', () => {
      const parsed1 = parseSmartQuery('Calvin Harris feat. Dua Lipa - One Kiss')
      expect(parsed1.artist).toBe('Calvin Harris feat. Dua Lipa')
      expect(parsed1.cleanQuery).toContain('One Kiss')

      const parsed2 = parseSmartQuery('Billie Eilish & Khalid - lovely')
      expect(parsed2.artist).toBe('Billie Eilish & Khalid')
      expect(parsed2.cleanQuery).toContain('lovely')
    })
  })

  describe('sanitizeTrackMetadata', () => {
    it('cleans dummy provider albums like "YouTube Music" or "Unknown Album"', () => {
      expect(DUMMY_PROVIDER_ALBUMS.has('youtube music')).toBe(true)
      expect(DUMMY_PROVIDER_ALBUMS.has('unknown album')).toBe(true)
    })
  })
})
