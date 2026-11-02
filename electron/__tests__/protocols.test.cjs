// @vitest-environment node
// describe/expect/it/vi come from Vitest's globals (vite.config.ts test.globals: true)

// Same require-cache-injection pattern as ipc-registry.test.cjs -- requiring the
// real 'electron' package outside the Electron binary returns a path string, not
// the API surface.
//
// The handler serves files through media-response.cjs's fileResponse (real
// byte-range responses), so these tests use real temp files and identify which
// file got served by its body.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const electronModulePath = require.resolve('electron')
const protocolsModulePath = require.resolve('../protocols.cjs')

/** Mirrors src/stage/media/resolveMediaPath.ts's toAppMediaUrl -- the URL the renderer really sends. */
function toAppMediaUrl(absolutePath, host = 'media') {
  const normalized = absolutePath.split(path.sep).join('/')
  const pathWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(pathWithSlash).replace(/#/g, '%23').replace(/[?]/g, '%3F')
  return `app-media://${host}${encoded}`
}

/** Writes `content` to `filePath` and returns it -- the content is the file's identity in a response body. */
function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content)
  return content
}

describe('registerAppMediaProtocol', () => {
  let registeredPrivileges
  let registeredScheme
  let registeredHandler

  beforeEach(() => {
    registeredPrivileges = null
    registeredScheme = null
    registeredHandler = null

    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: {
        protocol: {
          registerSchemesAsPrivileged: (schemes) => {
            registeredPrivileges = schemes
          },
          handle: (scheme, handler) => {
            registeredScheme = scheme
            registeredHandler = handler
          },
        },
      },
    }

    delete require.cache[protocolsModulePath]
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT register privileged schemes itself -- that is privileged-schemes.cjs\'s single combined call', () => {
    require('../protocols.cjs')
    // Two separate registerSchemesAsPrivileged calls used to unprivilege one
    // scheme, since Electron replaces the list rather than appending.
    expect(registeredPrivileges).toBeNull()
  })

  it('registers a protocol.handle callback for app-media once called', () => {
    const { registerAppMediaProtocol } = require('../protocols.cjs')
    registerAppMediaProtocol()
    expect(registeredScheme).toBe('app-media')
    expect(typeof registeredHandler).toBe('function')
  })

  describe('serving the requested file', () => {
    let dir

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-serve-'))
    })

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('maps an app-media:// request URL to the file on disk', async () => {
      const file = path.join(dir, 'song.mp3')
      const content = writeFile(file, 'song-mp3-bytes')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(file) })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('audio/mpeg')
      expect(await response.text()).toBe(content)
    })

    it('decodes URI-escaped characters in the path before serving', async () => {
      const file = path.join(dir, 'Paper Satellites.mp3')
      const content = writeFile(file, 'paper-satellites')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const url = toAppMediaUrl(file)
      expect(url).toContain('Paper%20Satellites.mp3')
      const response = await registeredHandler({ url })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content)
    })
  })

  describe('reporting the resolved path back to the renderer', () => {
    let songDir

    beforeEach(() => {
      songDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-resolved-'))
    })

    afterEach(() => {
      fs.rmSync(songDir, { recursive: true, force: true })
    })

    // Regression guard: the renderer derives a song's media directory from
    // this header. Without it, it stripped a segment off the requested
    // *folder* and pointed at the library root, so every #MP3/#VIDEO lookup
    // resolved to a file that does not exist.
    it('sets the resolved-path header on chart text so the renderer can find the song folder', async () => {
      const chart = writeFile(path.join(songDir, 'Artist - Title.txt'), '#ARTIST:Artist\n#TITLE:Title\n#BPM:120\n')

      const { registerAppMediaProtocol, RESOLVED_PATH_HEADER } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(songDir) })

      expect(response.status).toBe(200)
      expect(decodeURIComponent(response.headers.get(RESOLVED_PATH_HEADER))).toBe(
        path.join(songDir, 'Artist - Title.txt'),
      )
      // The renderer fetches cross-origin (dev server / file://), so the header
      // is only readable when it is explicitly exposed.
      expect(response.headers.get('access-control-expose-headers')).toBe(RESOLVED_PATH_HEADER)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(await response.text()).toBe(chart)
    })

    it('leaves media responses without the header and serves byte ranges so seeking keeps working', async () => {
      const mp3 = path.join(songDir, 'song.mp3')
      writeFile(mp3, '0123456789')

      const { registerAppMediaProtocol, RESOLVED_PATH_HEADER } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const full = await registeredHandler({ url: toAppMediaUrl(mp3) })
      expect(full.status).toBe(200)
      expect(full.headers.get(RESOLVED_PATH_HEADER)).toBeNull()
      expect(full.headers.get('accept-ranges')).toBe('bytes')

      const partial = await registeredHandler({
        url: toAppMediaUrl(mp3),
        headers: new Headers({ range: 'bytes=4-6' }),
      })
      expect(partial.status).toBe(206)
      expect(partial.headers.get('content-range')).toBe('bytes 4-6/10')
      expect(partial.headers.get(RESOLVED_PATH_HEADER)).toBeNull()
      expect(await partial.text()).toBe('456')
    })
  })

  describe('requesting a song folder (LibrarySong.path) instead of a chart file', () => {
    let songDir

    beforeEach(() => {
      songDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-song-'))
    })

    afterEach(() => {
      fs.rmSync(songDir, { recursive: true, force: true })
    })

    it('resolves a directory to the .txt chart file inside it, instead of serving the directory itself', async () => {
      writeFile(path.join(songDir, 'song.mp3'), 'mp3-bytes')
      const chart = writeFile(
        path.join(songDir, 'Some Artist - Some Title.txt'),
        '#ARTIST:Some Artist\n#TITLE:Some Title\n#BPM:120\n',
      )

      const { registerAppMediaProtocol, RESOLVED_PATH_HEADER } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(songDir) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(chart)
      expect(decodeURIComponent(response.headers.get(RESOLVED_PATH_HEADER))).toBe(
        path.join(songDir, 'Some Artist - Some Title.txt'),
      )
    })

    it('falls back to the directory itself if it contains no .txt file -- which is not a servable file (404)', async () => {
      const { registerAppMediaProtocol, resolveRequestedPath } = require('../protocols.cjs')
      registerAppMediaProtocol()

      expect(resolveRequestedPath(songDir)).toBe(songDir)
      const response = await registeredHandler({ url: toAppMediaUrl(songDir) })

      expect(response.status).toBe(404)
    })

    it('passes a real file path straight through, unaffected by the directory check', async () => {
      const filePath = path.join(songDir, 'song.mp3')
      const content = writeFile(filePath, 'the-real-mp3')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(filePath) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content)
    })
  })

  describe('a chart-tagged media filename that does not match the real file on disk', () => {
    let songDir

    beforeEach(() => {
      songDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-'))
    })

    afterEach(() => {
      fs.rmSync(songDir, { recursive: true, force: true })
    })

    it('falls back to the one audio file actually in the folder when the requested mp3 filename does not exist', async () => {
      const realMp3 = path.join(songDir, 'Some Song (Official Video).mp3')
      const content = writeFile(realMp3, 'official-video-audio')
      const taggedPath = path.join(songDir, 'Some Song.mp3') // what the chart's #MP3 tag says -- doesn't exist

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(taggedPath) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content)
    })

    it('falls back to the one video file actually in the folder when the requested video filename does not exist', async () => {
      const realVideo = path.join(songDir, 'downloaded-video-720p.mp4')
      const content = writeFile(realVideo, 'mp4-720p-bytes')
      // A literal "#" (UltraStar's own "[VD#0]" convention) -- percent-encoded
      // here exactly as src/stage/media/resolveMediaPath.ts's toAppMediaUrl
      // now does, so it survives as part of the path instead of being read
      // as the URL fragment separator.
      const taggedPath = path.join(songDir, 'Some Song [VD#0].avi')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(taggedPath) })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('video/mp4')
      expect(await response.text()).toBe(content)
    })

    it('gives up on the originally-requested path when no fallback file exists either, answering 404', async () => {
      const taggedPath = path.join(songDir, 'Some Song.mp3')

      const { registerAppMediaProtocol, resolveRequestedPath } = require('../protocols.cjs')
      registerAppMediaProtocol()

      expect(resolveRequestedPath(taggedPath)).toBe(taggedPath)
      const response = await registeredHandler({ url: toAppMediaUrl(taggedPath) })

      expect(response.status).toBe(404)
    })
  })

  describe('the exact-path host used for separated stems', () => {
    let songDir

    beforeEach(() => {
      songDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-exact-'))
    })

    afterEach(() => {
      fs.rmSync(songDir, { recursive: true, force: true })
    })

    it('serves a missing stem as itself (404) rather than substituting the full mix beside it', async () => {
      // Without this, a #VOCALS tag pointing at a file that is not there
      // resolves to the song's own mix -- and the whole song then plays a
      // second time on top of the instrumental.
      writeFile(path.join(songDir, 'full-mix.mp3'), 'full-mix')
      const missingStem = path.join(songDir, 'vocals.mp3')

      const { registerAppMediaProtocol, EXACT_MEDIA_HOST } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(missingStem, EXACT_MEDIA_HOST) })

      expect(response.status).toBe(404)
      expect(await response.text()).not.toBe('full-mix')
    })

    it('serves an existing stem normally', async () => {
      const stem = path.join(songDir, 'vocals.mp3')
      const content = writeFile(stem, 'vocals-stem')
      writeFile(path.join(songDir, 'full-mix.mp3'), 'full-mix')

      const { registerAppMediaProtocol, EXACT_MEDIA_HOST } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(stem, EXACT_MEDIA_HOST) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content)
    })

    it('leaves the default host\'s fallback behaviour completely untouched', async () => {
      const realMp3 = path.join(songDir, 'Some Song (Official Video).mp3')
      const content = writeFile(realMp3, 'official-video-audio')
      const taggedPath = path.join(songDir, 'Some Song.mp3')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(taggedPath) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content)
    })
  })

  describe('a song folder holding more than one .txt', () => {
    let songDir

    beforeEach(() => {
      songDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-multi-'))
    })

    afterEach(() => {
      fs.rmSync(songDir, { recursive: true, force: true })
    })

    it('serves the chart, never a readme sitting beside it -- whatever order the folder lists in', async () => {
      writeFile(path.join(songDir, 'aaa readme.txt'), 'Downloaded from somewhere. Have fun!\n')
      const chart = writeFile(path.join(songDir, 'Artist - Title.txt'), '#ARTIST:Artist\n#TITLE:Title\n#BPM:120\n: 0 1 60 la\nE\n')

      const { registerAppMediaProtocol, RESOLVED_PATH_HEADER } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(songDir) })

      expect(await response.text()).toBe(chart)
      expect(decodeURIComponent(response.headers.get(RESOLVED_PATH_HEADER))).toBe(path.join(songDir, 'Artist - Title.txt'))
    })

    it('prefers the solo chart over a duet chart in the same folder', async () => {
      writeFile(path.join(songDir, 'A - T [DUET].txt'), '#ARTIST:A\n#TITLE:T\n#BPM:120\nP1\n: 0 1 60 la\nE\n')
      const solo = writeFile(path.join(songDir, 'A - T.txt'), '#ARTIST:A\n#TITLE:T\n#BPM:120\n: 0 1 60 la\nE\n')

      const { registerAppMediaProtocol, RESOLVED_PATH_HEADER } = require('../protocols.cjs')
      registerAppMediaProtocol()

      const response = await registeredHandler({ url: toAppMediaUrl(songDir) })

      expect(await response.text()).toBe(solo)
      expect(decodeURIComponent(response.headers.get(RESOLVED_PATH_HEADER))).toBe(path.join(songDir, 'A - T.txt'))
    })
  })

  describe('confined to the allowed roots', () => {
    let allowedDir
    let otherDir

    beforeEach(() => {
      allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-allowed-'))
      otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-other-'))
    })

    afterEach(() => {
      fs.rmSync(allowedDir, { recursive: true, force: true })
      fs.rmSync(otherDir, { recursive: true, force: true })
    })

    it('serves a file under an allowed root', async () => {
      const file = path.join(allowedDir, 'song.mp3')
      const content = writeFile(file, 'allowed-song')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol({ getAllowedRoots: () => [allowedDir] })

      const response = await registeredHandler({ url: toAppMediaUrl(file) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content)
    })

    it('refuses any other absolute path with 403 and never touches the file system', async () => {
      const file = path.join(otherDir, 'secret.txt')
      writeFile(file, 'nope')

      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol({ getAllowedRoots: () => [allowedDir] })

      const statSync = vi.spyOn(fs, 'statSync')
      const stat = vi.spyOn(fs.promises, 'stat')
      const createReadStream = vi.spyOn(fs, 'createReadStream')

      const response = await registeredHandler({ url: toAppMediaUrl(file) })

      expect(response.status).toBe(403)
      expect(await response.text()).not.toBe('nope')
      expect(statSync).not.toHaveBeenCalled()
      expect(stat).not.toHaveBeenCalled()
      expect(createReadStream).not.toHaveBeenCalled()
    })

    it('refuses ../ escapes from an allowed root', async () => {
      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol({ getAllowedRoots: () => [allowedDir] })

      const response = await registeredHandler({
        url: `${toAppMediaUrl(allowedDir)}/%2E%2E/${path.basename(otherDir)}/x.mp3`,
      })

      expect(response.status).toBe(403)
    })

    it('answers 400 for a malformed percent-escape', async () => {
      const { registerAppMediaProtocol } = require('../protocols.cjs')
      registerAppMediaProtocol({ getAllowedRoots: () => [allowedDir] })

      const response = await registeredHandler({ url: `${toAppMediaUrl(allowedDir)}/50%zz.mp3` })

      expect(response.status).toBe(400)
    })
  })

  describe('requestUrlToPath', () => {
    it('strips the slash the renderer puts ahead of a Windows drive letter, and decodes', () => {
      const { requestUrlToPath } = require('../protocols.cjs')
      const decoded = requestUrlToPath('aetherstar-media://roots/D:/Songs/a%23b.mp3', 'win32')
      // path.normalize is the host's own; on Windows this is D:\Songs\a#b.mp3.
      expect(decoded.startsWith('D:')).toBe(true)
      expect(decoded.endsWith('a#b.mp3')).toBe(true)
    })

    it('keeps a POSIX absolute path absolute', () => {
      const { requestUrlToPath } = require('../protocols.cjs')
      expect(requestUrlToPath('app-media://media/Users/x/Let%20Me.mp3', 'darwin')).toBe(path.normalize('/Users/x/Let Me.mp3'))
    })

    it('returns null for an undecodable URL instead of throwing', () => {
      const { requestUrlToPath } = require('../protocols.cjs')
      expect(requestUrlToPath('app-media://media/x/100%.mp3', 'win32')).toBeNull()
      expect(requestUrlToPath('not a url')).toBeNull()
    })
  })
})
