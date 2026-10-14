import assert from 'node:assert/strict'
import { parseArtists, formatArtistsDisplay, getArtistId } from '../src/shared/artistParser.js'

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

console.log('All multi-artist parser tests passed successfully!')
