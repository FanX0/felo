import assert from 'assert'
import {
  normalizeForMatching,
  cleanSearchQuery,
  parseAudioFilePath,
  stringSimilarity,
  scoreProviderMatch,
  parseSmartQuery
} from '../src/shared/songMatching.js'

console.log('--- Running Song Matching Test Suite ---')

// 1. Normalization & Version Keyword Preservation
{
  const normStudio = normalizeForMatching('Radiohead - Creep [Official Music Video 4K]')
  const normLive = normalizeForMatching('Radiohead - Creep (Live in Oxford)')
  const normRemix = normalizeForMatching('Creep (Acoustic Version)')

  assert.strictEqual(normStudio, 'radiohead creep', 'Junk tags and suffix should be stripped')
  assert(normLive.includes('live'), 'Live keyword must be preserved in normalized form')
  assert(normRemix.includes('acoustic'), 'Acoustic keyword must be preserved in normalized form')
  console.log('✓ Normalization correctly strips video noise while preserving version keywords')
}

// 2. Query Cleaner
{
  const q1 = cleanSearchQuery('Kendrick Lamar', 'HUMBLE. (Official Video)')
  assert.strictEqual(q1, 'Kendrick Lamar HUMBLE.', 'Should format clean artist and title')

  const q2 = cleanSearchQuery('Queen', 'Queen - Bohemian Rhapsody')
  assert.strictEqual(q2, 'Queen - Bohemian Rhapsody', 'Should not duplicate artist when title already starts with it')

  const q3 = cleanSearchQuery('Daft Punk', '01 - Get Lucky (feat. Pharrell Williams) [HD]')
  assert.strictEqual(q3, 'Daft Punk Get Lucky', 'Should clean track numbers, feat, and junk tags')
  console.log('✓ cleanSearchQuery produces pristine queries for streaming providers')
}

// 3. Audio File Path Parser (Soulseek / Local)
{
  const path1 = 'D:\\Music\\Pink Floyd\\The Dark Side of the Moon\\02 - Time.flac'
  const parsed1 = parseAudioFilePath(path1)
  assert.strictEqual(parsed1.title, 'Time', 'Should parse title from path1')
  assert.strictEqual(parsed1.artist, 'Pink Floyd', 'Should derive artist from path1 hierarchy')
  assert.strictEqual(parsed1.album, 'The Dark Side of the Moon', 'Should derive album from path1 hierarchy')

  const path2 = 'C:/Shares/Music/The Beatles - Abbey Road (1969) [FLAC]/01. Come Together.flac'
  const parsed2 = parseAudioFilePath(path2)
  assert.strictEqual(parsed2.title, 'Come Together', 'Should parse title from path2')
  assert.strictEqual(parsed2.artist, 'The Beatles', 'Should parse artist from folder with dash')

  const path3 = 'SoulseekShared/Daft Punk - Get Lucky (Radio Edit).mp3'
  const parsed3 = parseAudioFilePath(path3)
  assert.strictEqual(parsed3.artist, 'Daft Punk', 'Should parse artist from filename')
  assert.strictEqual(parsed3.title, 'Get Lucky (Radio Edit)', 'Should parse title from filename')
  console.log('✓ parseAudioFilePath correctly extracts artist, album, and title from P2P paths')
}

// 4. String Edit Similarity
{
  const simExact = stringSimilarity('blinding lights', 'blinding lights')
  const simMinor = stringSimilarity('blinding lights', 'blindng lights') // 1 typo
  const simDiff = stringSimilarity('blinding lights', 'hotel california')

  assert.strictEqual(simExact, 1, 'Exact strings have similarity 1')
  assert(simMinor > 0.85, 'Minor typo has high similarity')
  assert(simDiff < 0.3, 'Completely different titles have low similarity')
  console.log('✓ stringSimilarity measures Levenshtein distance accurately')
}

// 5. scoreProviderMatch - Exact Studio Match
{
  const target = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
  const studioCand = {
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    meta: 'FLAC Lossless'
  }
  const scoreStudio = scoreProviderMatch(target, studioCand)
  assert(scoreStudio.score >= 95, `Expected score >= 95, got ${scoreStudio.score}`)
  assert.strictEqual(scoreStudio.confidence, 'Exact match')
  assert.strictEqual(scoreStudio.isAcceptable, true)
  console.log(`✓ Exact studio match scored ${scoreStudio.score}% (${scoreStudio.confidence})`)
}

// 6. scoreProviderMatch - Candidate with Unwanted Live / Remix
{
  const target = { title: 'Creep', artist: 'Radiohead', duration: 238 }
  const liveCand = {
    title: 'Creep (Live at Reading Festival)',
    artist: 'Radiohead',
    duration: 275,
    meta: 'FLAC Lossless'
  }
  const scoreLive = scoreProviderMatch(target, liveCand)
  assert(scoreLive.score < 50, `Expected score < 50 for unwanted live version, got ${scoreLive.score}`)
  assert.strictEqual(scoreLive.isAcceptable, false, 'Unwanted live cut must not be acceptable')
  console.log(`✓ Unwanted live version penalized correctly down to ${scoreLive.score}% (acceptable: ${scoreLive.isAcceptable})`)
}

// 7. scoreProviderMatch - Candidate when Target Specifically Requests Acoustic
{
  const targetAcoustic = { title: 'Creep (Acoustic)', artist: 'Radiohead', duration: 240 }
  const candAcoustic = {
    title: 'Creep (Acoustic Version)',
    artist: 'Radiohead',
    duration: 242,
    meta: 'FLAC Lossless'
  }
  const candStudio = {
    title: 'Creep',
    artist: 'Radiohead',
    duration: 238,
    meta: 'FLAC Lossless'
  }
  const scoreAcousticMatch = scoreProviderMatch(targetAcoustic, candAcoustic)
  const scoreStudioMismatch = scoreProviderMatch(targetAcoustic, candStudio)

  assert(scoreAcousticMatch.score > scoreStudioMismatch.score, 'Acoustic candidate must rank higher than studio when target requested acoustic')
  assert(scoreAcousticMatch.isAcceptable, 'Acoustic candidate must be acceptable')
  console.log(`✓ Version alignment: Acoustic match scored ${scoreAcousticMatch.score}%, regular studio scored ${scoreStudioMismatch.score}%`)
}

// 8. scoreProviderMatch - Duration Mismatch Penalty
{
  const target = { title: 'Get Lucky', artist: 'Daft Punk', duration: 248 }
  const candExtended = {
    title: 'Get Lucky',
    artist: 'Daft Punk',
    duration: 620 // 10 minute mix
  }
  const scoreExtended = scoreProviderMatch(target, candExtended)
  assert(scoreExtended.score < 50, `Expected score < 50 for 10-minute mix, got ${scoreExtended.score}`)
  console.log(`✓ Duration discrepancy penalized correctly down to ${scoreExtended.score}%`)
}

// 9. scoreProviderMatch - Soulseek Peer Artist extraction
{
  const target = { title: 'Come Together', artist: 'The Beatles', duration: 259 }
  const soulseekCand = {
    title: 'The Beatles - Come Together',
    artist: 'Peer: cool_music_collector',
    duration: 259,
    meta: 'Instant Slot'
  }
  const scoreSlsk = scoreProviderMatch(target, soulseekCand)
  assert(scoreSlsk.score >= 85, `Expected score >= 85 for parsed artist in candidate title, got ${scoreSlsk.score}`)
  assert.strictEqual(scoreSlsk.isAcceptable, true)
  console.log(`✓ Soulseek candidate with artist in title scored ${scoreSlsk.score}% (${scoreSlsk.confidence})`)
}

// 10. scoreProviderMatch - Multi-artist / collaboration freeform query
{
  const target = { title: cleanSearchQuery(undefined, undefined, 'feby hussein song') }
  const candCollaboration = {
    title: 'Walau Berantakan (Special Live Session)',
    artist: 'Prince Husein & Feby Putri',
    duration: 250
  }
  const scoreCollab = scoreProviderMatch(target, candCollaboration)
  assert(scoreCollab.score >= 70, `Expected score >= 70 for collaboration match, got ${scoreCollab.score}`)
  assert.strictEqual(scoreCollab.isAcceptable, true)
  console.log(`✓ Collaboration freeform query scored ${scoreCollab.score}% (${scoreCollab.confidence})`)
}

// 11. parseSmartQuery - Natural language and connector queries
{
  const p1 = parseSmartQuery('Walau Berantakan by Prince Husein')
  assert.strictEqual(p1.title, 'Walau Berantakan')
  assert.strictEqual(p1.artist, 'Prince Husein')
  assert.strictEqual(p1.cleanQuery, 'Prince Husein Walau Berantakan')

  const p2 = parseSmartQuery('Coldplay - Yellow')
  assert.strictEqual(p2.artist, 'Coldplay')
  assert.strictEqual(p2.title, 'Yellow')

  const p3 = parseSmartQuery('feby hussein song')
  assert.strictEqual(p3.cleanQuery, 'feby hussein')

  const p4 = parseSmartQuery('Prince Husein feat. Feby Putri - Walau Berantakan')
  assert.strictEqual(p4.isCollaboration, true)
  assert.strictEqual(p4.title, 'Walau Berantakan')
  console.log('✓ parseSmartQuery accurately decomposes connectors, artists, and collaborations')
}

console.log('\n--- All 11 Song Matching Verification Tests Passed Successfully! ---')
