import { describe, it, expect } from 'vitest'
import {
  parseArtists,
  formatArtistsDisplay,
  getArtistId,
  cleanTrackTitle
} from '../../../src/shared/artistParser'

describe('Shared Core: artistParser', () => {
  it('parses basic comma-separated artists with primary and featured roles', () => {
    const result = parseArtists('Bruno Mars, Anderson .Paak')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ name: 'Bruno Mars', role: 'primary' })
    expect(result[1]).toEqual({ name: 'Anderson .Paak', role: 'featured' })
  })

  it('parses featuring tokens (feat., ft., featuring)', () => {
    const result1 = parseArtists('Drake feat. 21 Savage')
    expect(result1).toHaveLength(2)
    expect(result1[0]).toEqual({ name: 'Drake', role: 'primary' })
    expect(result1[1]).toEqual({ name: '21 Savage', role: 'featured' })

    const result2 = parseArtists('Dua Lipa ft. DaBaby')
    expect(result2).toHaveLength(2)
    expect(result2[0].name).toBe('Dua Lipa')
    expect(result2[1].name).toBe('DaBaby')
  })

  it('parses ampersand separations correctly', () => {
    const result = parseArtists('Lady Gaga & Bradley Cooper')
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Lady Gaga')
    expect(result[1].name).toBe('Bradley Cooper')
  })

  it('preserves multi-word entity bands with comma or ampersand', () => {
    const bands = [
      'Earth, Wind & Fire',
      'Tyler, The Creator',
      'Simon & Garfunkel',
      'AC/DC',
      'Crosby, Stills, Nash & Young'
    ]

    for (const band of bands) {
      const result = parseArtists(band)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe(band)
    }
  })

  it('combines preserved entity band with featured guest artist', () => {
    const result = parseArtists('Earth, Wind & Fire feat. Ramsey Lewis')
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Earth, Wind & Fire')
    expect(result[0].role).toBe('primary')
    expect(result[1].name).toBe('Ramsey Lewis')
    expect(result[1].role).toBe('featured')
  })

  it('formats artist display cleanly', () => {
    const display = formatArtistsDisplay([
      { name: 'Lady Gaga', role: 'primary' },
      { name: 'Bruno Mars', role: 'primary' }
    ])
    expect(display).toBe('Lady Gaga, Bruno Mars')
  })

  it('generates deterministic artist IDs regardless of casing', () => {
    const id1 = getArtistId('Bruno Mars')
    const id2 = getArtistId('bruno mars')
    const id3 = getArtistId('BRUNO MARS ')
    expect(id1).toBe(id2)
    expect(id2).toBe(id3)
  })

  it('cleans track titles of featured artist noise', () => {
    expect(cleanTrackTitle('Levitating (feat. DaBaby)')).toBe('Levitating')
    expect(cleanTrackTitle('STAY (with Justin Bieber)')).toBe('STAY')
    expect(cleanTrackTitle('Industry Baby [feat Lil Nas X]')).toBe('Industry Baby')
    expect(cleanTrackTitle('Plain Song Title')).toBe('Plain Song Title')
  })

  it('extracts featured artists from song title when track title contains feat', () => {
    const res = parseArtists('The Kid LAROI', undefined, 'STAY (with Justin Bieber)')
    expect(res).toHaveLength(2)
    expect(res[0].name).toBe('The Kid LAROI')
    expect(res[1].name).toBe('Justin Bieber')
    expect(res[1].role).toBe('featured')
  })

  it('utilizes in-memory cache for fast repeated queries', () => {
    const first = parseArtists('Coldplay & BTS')
    const second = parseArtists('Coldplay & BTS')
    expect(first).toBe(second) // exact object reference from LRU cache
  })
})
