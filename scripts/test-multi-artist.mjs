import assert from 'node:assert/strict'
import { parseArtists, formatArtistsDisplay, getArtistId, cleanTrackTitle } from '../src/shared/artistParser.ts'

console.log('Testing Multi-Artist Parser...')

// 1. Basic comma separation
{
  const result = parseArtists('Bruno Mars, Anderson .Paak')
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'Bruno Mars')
  assert.equal(result[0].role, 'primary')
  assert.equal(result[1].name, 'Anderson .Paak')
  assert.equal(result[1].role, 'featured')
}

// 2. Featuring
{
  const result = parseArtists('Drake feat. 21 Savage')
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'Drake')
  assert.equal(result[0].role, 'primary')
  assert.equal(result[1].name, '21 Savage')
  assert.equal(result[1].role, 'featured')
}

// 3. Ampersand
{
  const result = parseArtists('Lady Gaga & Bradley Cooper')
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'Lady Gaga')
  assert.equal(result[1].name, 'Bradley Cooper')
}

// 4. Preserved entities with comma or ampersand
{
  const result1 = parseArtists('Earth, Wind & Fire')
  assert.equal(result1.length, 1)
  assert.equal(result1[0].name, 'Earth, Wind & Fire')

  const result2 = parseArtists('Tyler, The Creator')
  assert.equal(result2.length, 1)
  assert.equal(result2[0].name, 'Tyler, The Creator')

  const result3 = parseArtists('Simon & Garfunkel')
  assert.equal(result3.length, 1)
  assert.equal(result3[0].name, 'Simon & Garfunkel')

  const result4 = parseArtists('AC/DC')
  assert.equal(result4.length, 1)
  assert.equal(result4[0].name, 'AC/DC')
}

// 5. Preserved entity combined with featured artist
{
  const result = parseArtists('Earth, Wind & Fire feat. Ramsey Lewis')
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'Earth, Wind & Fire')
  assert.equal(result[0].role, 'primary')
  assert.equal(result[1].name, 'Ramsey Lewis')
  assert.equal(result[1].role, 'featured')
}

// 6. formatArtistsDisplay
{
  const display = formatArtistsDisplay([
    { name: 'Lady Gaga', role: 'primary' },
    { name: 'Bruno Mars', role: 'primary' }
  ])
  assert.equal(display, 'Lady Gaga, Bruno Mars')
}

// 7. Deterministic ID generation
{
  const id1 = getArtistId('Bruno Mars')
  const id2 = getArtistId('bruno mars')
  assert.equal(id1, id2)
}

// 8. cleanTrackTitle
{
  assert.equal(cleanTrackTitle('Levitating (feat. DaBaby)'), 'Levitating')
  assert.equal(cleanTrackTitle('STAY (with Justin Bieber)'), 'STAY')
  assert.equal(cleanTrackTitle('Industry Baby [feat Lil Nas X]'), 'Industry Baby')
  assert.equal(cleanTrackTitle('Plain Song Title'), 'Plain Song Title')
}

// 9. Track title feature extraction with dot-less ft and with
{
  const res1 = parseArtists('The Kid LAROI', undefined, 'STAY (with Justin Bieber)')
  assert.equal(res1.length, 2)
  assert.equal(res1[0].name, 'The Kid LAROI')
  assert.equal(res1[1].name, 'Justin Bieber')
  assert.equal(res1[1].role, 'featured')

  const res2 = parseArtists('Dua Lipa', undefined, 'Levitating (ft DaBaby)')
  assert.equal(res2.length, 2)
  assert.equal(res2[0].name, 'Dua Lipa')
  assert.equal(res2[1].name, 'DaBaby')
  assert.equal(res2[1].role, 'featured')
}

// 10. LRU / Memory Cache lookup returns identical references
{
  const first = parseArtists('Coldplay & BTS')
  const second = parseArtists('Coldplay & BTS')
  assert.equal(first, second)
}

console.log('All multi-artist parser tests passed successfully!')
