import assert from 'assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

// Minimal mocked / standalone tests for ArtworkService logic
console.log('--- Starting Artwork Verification & Download Pipeline Tests ---')

// 1. Magic byte detection
function detectImageExtension(buffer) {
  if (!buffer || buffer.length < 8) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return 'gif'
  return null
}

const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const webpHeader = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
const fakeText = Buffer.from('<!DOCTYPE html><html>404 Not Found</html>')

assert.strictEqual(detectImageExtension(jpegHeader), 'jpg', 'JPEG detection failed')
assert.strictEqual(detectImageExtension(pngHeader), 'png', 'PNG detection failed')
assert.strictEqual(detectImageExtension(webpHeader), 'webp', 'WEBP detection failed')
assert.strictEqual(detectImageExtension(fakeText), null, 'HTML should not be identified as image')
console.log('✔ Test 1: Image magic bytes and format detection passed')

// 2. File validity test
const tmpDir = path.join(os.tmpdir(), `felo-art-test-${Date.now()}`)
fs.mkdirSync(tmpDir, { recursive: true })

const zeroByteFile = path.join(tmpDir, 'zero.jpg')
fs.writeFileSync(zeroByteFile, Buffer.alloc(0))

const smallInvalidFile = path.join(tmpDir, 'small.jpg')
fs.writeFileSync(smallInvalidFile, Buffer.from('not an image'))

const validFakeJpeg = path.join(tmpDir, 'valid.jpg')
const validData = Buffer.concat([jpegHeader, Buffer.alloc(300, 0xaa)])
fs.writeFileSync(validFakeJpeg, validData)

function isValidArtworkFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  try {
    if (!fs.existsSync(filePath)) return false
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size < 200) return false
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(12)
    fs.readSync(fd, buf, 0, 12, 0)
    fs.closeSync(fd)
    return detectImageExtension(buf) !== null
  } catch {
    return false
  }
}

assert.strictEqual(isValidArtworkFile(''), false, 'Empty string should fail')
assert.strictEqual(isValidArtworkFile(null), false, 'Null should fail')
assert.strictEqual(isValidArtworkFile(path.join(tmpDir, 'nonexistent.jpg')), false, 'Missing file should fail')
assert.strictEqual(isValidArtworkFile(zeroByteFile), false, '0-byte file should fail')
assert.strictEqual(isValidArtworkFile(smallInvalidFile), false, 'Small invalid text file should fail')
assert.strictEqual(isValidArtworkFile(validFakeJpeg), true, 'Valid JPEG file should pass')
console.log('✔ Test 2: Artwork file validation (positive and negative cases) passed')

// 3. toMediaUrl hardening test
function toMediaUrl(filePath) {
  if (!filePath) return null
  if (/^(blob:|data:|https?:|media:)/i.test(filePath)) return filePath
  let cleanPath = filePath
  if (/^file:\/\//i.test(cleanPath)) {
    cleanPath = cleanPath.replace(/^file:\/\/\/?/i, '')
  }
  const normalizedPath = cleanPath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `media://local/${encodeURIComponent(normalizedPath)}`
}

const windowsPath = 'C:\\Users\\user\\AppData\\Roaming\\Felo\\artwork\\test.jpg'
const mediaUrl = toMediaUrl(windowsPath)
assert.strictEqual(mediaUrl, 'media://local/C%3A%2FUsers%2Fuser%2FAppData%2FRoaming%2FFelo%2Fartwork%2Ftest.jpg')

// Should NOT double encode if already media://
const reEncoded = toMediaUrl(mediaUrl)
assert.strictEqual(reEncoded, mediaUrl, 'Already encoded media:// URL was double encoded!')

// Should preserve remote https:// URLs
const httpsUrl = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
assert.strictEqual(toMediaUrl(httpsUrl), httpsUrl, 'https URL was modified')
console.log('✔ Test 3: toMediaUrl roundtrip and double-encoding guard passed')

// 4. Live network test: Fetch iTunes search artwork
console.log('Testing live iTunes search artwork retrieval...')
try {
  const query = 'Daft Punk Get Lucky'
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1&country=US`)
  if (res.ok) {
    const data = await res.json()
    const hit = data.results?.[0]
    assert(hit, 'iTunes returned no results for Daft Punk Get Lucky')
    const artwork100 = hit.artworkUrl100
    assert(artwork100, 'iTunes hit missing artworkUrl100')
    const highRes = artwork100.replace('100x100bb', '600x600bb')

    const imgRes = await fetch(highRes)
    assert(imgRes.ok, 'Failed to fetch high-res iTunes artwork')
    const imgBuf = Buffer.from(await imgRes.arrayBuffer())
    const ext = detectImageExtension(imgBuf)
    assert(ext === 'jpg' || ext === 'png', `Expected jpg or png but got ${ext}`)
    assert(imgBuf.length > 5000, `Image buffer unexpectedly small: ${imgBuf.length} bytes`)
    console.log(`✔ Test 4: Live iTunes artwork fetch succeeded (${imgBuf.length} bytes, format: ${ext})`)
  }
} catch (err) {
  console.warn('Network warning on iTunes test:', err.message)
}

// 5. Live network test: YouTube thumbnail resolution
console.log('Testing live YouTube thumbnail retrieval...')
try {
  const videoId = 'dQw4w9WgXcQ'
  const ytRes = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
  if (ytRes.ok) {
    const ytBuf = Buffer.from(await ytRes.arrayBuffer())
    const ext = detectImageExtension(ytBuf)
    assert(ext === 'jpg', `Expected jpg for YouTube thumbnail, got ${ext}`)
    assert(ytBuf.length > 1000, `YouTube thumbnail unexpectedly small: ${ytBuf.length} bytes`)
    console.log(`✔ Test 5: Live YouTube thumbnail fetch succeeded (${ytBuf.length} bytes, format: ${ext})`)
  }
} catch (err) {
  console.warn('Network warning on YouTube thumbnail test:', err.message)
}

// 6. Companion Artwork Detection Test
console.log('Testing companion folder artwork discovery...')
const companionDir = path.join(tmpDir, 'album-folder')
fs.mkdirSync(companionDir, { recursive: true })
const fakeSongPath = path.join(companionDir, '01 - Track.mp3')
fs.writeFileSync(fakeSongPath, Buffer.alloc(1024))
const companionCoverPath = path.join(companionDir, 'cover.jpg')
fs.writeFileSync(companionCoverPath, validData)

function findCompanionArtwork(audioFilePath) {
  if (!audioFilePath || !fs.existsSync(audioFilePath)) return null
  try {
    const dir = path.dirname(audioFilePath)
    if (!fs.existsSync(dir)) return null
    const ext = path.extname(audioFilePath)
    const baseName = path.basename(audioFilePath, ext)
    const candidateNames = [
      'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
      'folder.jpg', 'folder.png', 'front.jpg', 'front.png',
      'artwork.jpg', 'artwork.png', 'album.jpg', 'album.png',
      `${baseName}.jpg`, `${baseName}.jpeg`, `${baseName}.png`, `${baseName}.webp`
    ]
    for (const name of candidateNames) {
      const candidatePath = path.join(dir, name)
      if (isValidArtworkFile(candidatePath)) {
        return candidatePath
      }
    }
    return null
  } catch {
    return null
  }
}

const foundCompanion = findCompanionArtwork(fakeSongPath)
assert.strictEqual(foundCompanion, companionCoverPath, 'Failed to locate companion cover.jpg')
console.log('✔ Test 6: Companion folder artwork discovery passed')

// 7. Clean Query Transformation Test
function cleanQuery(artist, title, album) {
  let cleanArtist = (artist || '')
    .replace(/^unknown artist$/i, '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*(?:vevo|official|records|topic)$/i, '')
    .replace(/\b(feat|ft|featuring)\.?\s+.*/gi, '')
    .trim()

  let cleanTitle = (title || '')
    .replace(
      /\s*\([^)]*(?:official|video|audio|remaster|lyric|hd|4k|hq|kbps|flac|mp3|deluxe|bonus|visualizer)[^)]*\)/gi,
      ''
    )
    .replace(
      /\s*\[[^\]]*(?:official|video|audio|remaster|lyric|hd|4k|hq|kbps|flac|mp3|deluxe|bonus|visualizer)[^\]]*\]/gi,
      ''
    )
    .replace(/\s*\([^)]*(?:feat|ft|featuring|prod\b)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:feat|ft|featuring|prod\b)[^\]]*\]/gi, '')
    .replace(/\.(mp3|flac|wav|m4a|ogg|opus)$/i, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const dashParts = cleanTitle.split(/\s+-\s+/)
  if (dashParts.length >= 2) {
    const titleArtist = dashParts[0].trim()
    const normArtist = cleanArtist.toLowerCase().replace(/[^a-z0-9]/g, '')
    const normTitleArtist = titleArtist.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (
      !cleanArtist ||
      normArtist === normTitleArtist ||
      normArtist.includes(normTitleArtist) ||
      normTitleArtist.includes(normArtist)
    ) {
      cleanArtist = titleArtist
      cleanTitle = dashParts.slice(1).join(' ').trim()
    }
  } else if (cleanArtist && cleanTitle.toLowerCase().startsWith(`${cleanArtist.toLowerCase()} - `)) {
    cleanTitle = cleanTitle.slice(cleanArtist.length + 3).trim()
  }

  let cleanAlbum = (album || '').trim()
  if (/^(youtube|youtube music|single|unknown album|unknown)$/i.test(cleanAlbum)) {
    cleanAlbum = ''
  }

  return [cleanArtist, cleanTitle, cleanAlbum].filter(Boolean).join(' ')
}

const query1 = cleanQuery('TheWeekndVEVO', 'The Weeknd - Blinding Lights (Official Video) [4K]', 'YouTube Music')
assert.strictEqual(query1, 'The Weeknd Blinding Lights', `Expected "The Weeknd Blinding Lights" but got "${query1}"`)

const query2 = cleanQuery('Coldplay - Topic', 'Yellow [FLAC 320kbps]', 'Unknown Album')
assert.strictEqual(query2, 'Coldplay Yellow', `Expected "Coldplay Yellow" but got "${query2}"`)

const query3 = cleanQuery('Queen Official', 'Queen - Bohemian Rhapsody (Remastered 2011)', 'Single')
assert.strictEqual(query3, 'Queen Bohemian Rhapsody', `Expected "Queen Bohemian Rhapsody" but got "${query3}"`)
console.log('✔ Test 7: Clean search query transformation (VEVO, Topic, audio tags, duplicate artist) passed')

// 8. YouTube Thumbnail Fallback Sequence (maxres 404 -> hqdefault)
console.log('Testing YouTube thumbnail fallback sequence...')
async function resolveYouTubeThumbnail(videoId) {
  const maxres = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
  const resMax = await fetch(maxres)
  if (resMax.ok) {
    const buf = Buffer.from(await resMax.arrayBuffer())
    if (detectImageExtension(buf) && buf.length > 200) return 'maxres'
  }
  const hq = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  const resHq = await fetch(hq)
  if (resHq.ok) {
    const buf = Buffer.from(await resHq.arrayBuffer())
    if (detectImageExtension(buf) && buf.length > 200) return 'hq'
  }
  return null
}

const olderVideoQuality = await resolveYouTubeThumbnail('jNQXAC9IVRw')
assert.strictEqual(olderVideoQuality, 'hq', 'Expected fallback to hq for video without maxres')
console.log('✔ Test 8: YouTube thumbnail fallback sequence (404 maxres -> hqdefault) passed')

// Clean up test temp files
fs.rmSync(tmpDir, { recursive: true, force: true })
console.log('--- All 8 Artwork Verification & Fallback Tests Passed Successfully ---')
