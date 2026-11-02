// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fileResponse, parseRange, mimeTypeFor } = require('../media-response.cjs')

/** The minimal request shape protocol.handle passes in. */
function requestWithRange(range) {
  return { url: 'app-media://media/x', headers: new Headers(range === undefined ? {} : { range }) }
}

describe('parseRange', () => {
  it('returns null without a Range header', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('', 100)).toBeNull()
  })

  it('reads an open-ended range to the end of the file', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=40-', 100)).toEqual({ start: 40, end: 99 })
  })

  it('reads a closed range inclusively', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
  })

  it('reads a suffix range as the last N bytes', () => {
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('clamps a suffix longer than the file to the whole file', () => {
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })

  it('clamps an end beyond the file size to the last byte', () => {
    expect(parseRange('bytes=50-5000', 100)).toEqual({ start: 50, end: 99 })
  })

  it('treats a start at or past the end of the file as unsatisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=150-200', 100)).toBe('invalid')
    expect(parseRange('bytes=0-', 0)).toBe('invalid')
  })

  it('treats start > end, an empty range and a zero-length suffix as unsatisfiable', () => {
    expect(parseRange('bytes=50-10', 100)).toBe('invalid')
    expect(parseRange('bytes=-', 100)).toBe('invalid')
    expect(parseRange('bytes=-0', 100)).toBe('invalid')
  })

  it('ignores malformed, multi-range and non-byte ranges (null -> whole file)', () => {
    expect(parseRange('bytes=0-10,20-30', 100)).toBeNull()
    expect(parseRange('items=0-10', 100)).toBeNull()
    expect(parseRange('bytes=abc-def', 100)).toBeNull()
    expect(parseRange('garbage', 100)).toBeNull()
  })
})

describe('mimeTypeFor', () => {
  it.each([
    ['song.wav', 'audio/wav'],
    ['song.mp3', 'audio/mpeg'],
    ['SONG.MP3', 'audio/mpeg'],
    ['video.mp4', 'video/mp4'],
    ['video.webm', 'video/webm'],
    ['cover.png', 'image/png'],
    ['chart.txt', 'text/plain; charset=utf-8'],
    ['mystery.xyz', 'application/octet-stream'],
  ])('%s -> %s', (file, expected) => {
    expect(mimeTypeFor(file)).toBe(expected)
  })
})

describe('fileResponse', () => {
  let dir

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-response-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function write(name, content) {
    const filePath = path.join(dir, name)
    fs.writeFileSync(filePath, content)
    return filePath
  }

  it('serves the whole file (200) with content-length and accept-ranges when no range is asked for', async () => {
    const file = write('song.mp3', '0123456789')

    const response = await fileResponse(file, requestWithRange())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('content-range')).toBeNull()
    expect(await response.text()).toBe('0123456789')
  })

  it('tolerates a request without headers at all', async () => {
    const file = write('song.mp3', 'abc')

    const response = await fileResponse(file, undefined)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc')
  })

  it('serves a closed range as 206 with the exact bytes, content-range and content-length', async () => {
    const file = write('video.mp4', '0123456789abcdef')

    const response = await fileResponse(file, requestWithRange('bytes=3-7'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 3-7/16')
    expect(response.headers.get('content-length')).toBe('5')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(await response.text()).toBe('34567')
  })

  it('serves an open-ended range from a far offset to the end (a far seek)', async () => {
    const bytes = Buffer.alloc(4096, 0)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const file = write('long.webm', bytes)

    const response = await fileResponse(file, requestWithRange('bytes=4000-'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 4000-4095/4096')
    expect(response.headers.get('content-length')).toBe('96')
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(4000))).toBe(true)
  })

  it('serves a suffix range as the last bytes of the file', async () => {
    const file = write('song.wav', '0123456789')

    const response = await fileResponse(file, requestWithRange('bytes=-3'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 7-9/10')
    expect(await response.text()).toBe('789')
  })

  it('answers an unsatisfiable range with 416 and `bytes */size`', async () => {
    const file = write('song.mp3', '0123456789')

    const response = await fileResponse(file, requestWithRange('bytes=10-'))

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
    expect(await response.text()).toBe('')
  })

  it('falls back to the whole file for a multi-range request', async () => {
    const file = write('song.mp3', '0123456789')

    const response = await fileResponse(file, requestWithRange('bytes=0-1,4-5'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
  })

  it('merges extra headers into every response', async () => {
    const file = write('chart.txt', '#TITLE:T\n')

    const response = await fileResponse(file, requestWithRange(), { 'x-extra': 'yes' })

    expect(response.headers.get('x-extra')).toBe('yes')
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await response.text()).toBe('#TITLE:T\n')
  })

  it.each([
    ['a.wav', 'audio/wav'],
    ['a.mp3', 'audio/mpeg'],
    ['a.mp4', 'video/mp4'],
    ['a.webm', 'video/webm'],
    ['a.png', 'image/png'],
    ['a.txt', 'text/plain; charset=utf-8'],
  ])('sends the MIME type for %s', async (name, expected) => {
    const file = write(name, 'x')
    const response = await fileResponse(file, requestWithRange())
    expect(response.headers.get('content-type')).toBe(expected)
  })

  it('serves a zero-byte file as an empty 200, and any range on it as 416', async () => {
    const file = write('empty.mp3', '')

    const full = await fileResponse(file, requestWithRange())
    expect(full.status).toBe(200)
    expect(full.headers.get('content-length')).toBe('0')
    expect(await full.text()).toBe('')

    const ranged = await fileResponse(file, requestWithRange('bytes=0-'))
    expect(ranged.status).toBe(416)
    expect(ranged.headers.get('content-range')).toBe('bytes */0')
  })

  it('answers 404 for a directory', async () => {
    const response = await fileResponse(dir, requestWithRange())
    expect(response.status).toBe(404)
  })

  it('rejects for a missing file so the protocol handler can answer 404', async () => {
    await expect(fileResponse(path.join(dir, 'missing.mp3'), requestWithRange())).rejects.toThrow()
  })
})
