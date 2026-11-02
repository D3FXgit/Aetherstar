// @vitest-environment node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const electronModulePath = require.resolve('electron')
const mediaProtocolModulePath = require.resolve('../media-protocol.cjs')
const protocolsModulePath = require.resolve('../../protocols.cjs')

function requireMediaProtocolWithMockedElectron() {
  const registeredSchemes = []
  const handlers = {}

  require.cache[electronModulePath] = {
    id: electronModulePath,
    filename: electronModulePath,
    loaded: true,
    exports: {
      protocol: {
        registerSchemesAsPrivileged: (schemes) => registeredSchemes.push(...schemes),
        handle: (scheme, handler) => {
          handlers[scheme] = handler
        },
      },
    },
  }

  delete require.cache[mediaProtocolModulePath]
  delete require.cache[protocolsModulePath]
  const mod = require('../media-protocol.cjs')
  return { mod, registeredSchemes, handlers }
}

/** Mirrors src/library/mediaUrl.ts's toLibraryMediaUrl -- the URL the renderer really sends. */
function toLibraryMediaUrl(absolutePath) {
  const normalized = absolutePath.split(path.sep).join('/')
  const pathWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(pathWithSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return `aetherstar-media://roots${encoded}`
}

describe('registerMediaProtocol', () => {
  afterEach(() => {
    delete require.cache[electronModulePath]
    delete require.cache[mediaProtocolModulePath]
    delete require.cache[protocolsModulePath]
  })

  it('registerMediaProtocol installs the request handler', () => {
    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [], thumbnailsDir: '/thumbs' })
    expect(typeof handlers['aetherstar-media']).toBe('function')
  })

  it('resolves a request for a file under a known root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-'))
    const coverPath = path.join(root, 'cover.jpg')
    fs.writeFileSync(coverPath, 'jpeg-bytes')

    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: toLibraryMediaUrl(coverPath) })
    const body = await response.text()
    expect(body).toBe('jpeg-bytes')
  })

  it('serves a file whose name needs percent-encoding (#, spaces, umlauts)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-enc-'))
    const songDir = path.join(root, 'Die Ärzte - Schrei nach Liebe')
    fs.mkdirSync(songDir)
    const audio = path.join(songDir, 'a#b [VD#1].mp3')
    fs.writeFileSync(audio, 'mp3-bytes')

    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: toLibraryMediaUrl(audio) })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('mp3-bytes')
  })

  it('answers a malformed percent-escape with 400 instead of throwing out of the handler', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-bad-'))
    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: `${toLibraryMediaUrl(root)}/100%zz.mp3` })
    expect(response.status).toBe(400)
  })

  it('rejects a path outside any known root (traversal attempt)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-safe-'))
    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: 'aetherstar-media://roots/etc/passwd' })
    expect(response.status).toBe(403)
  })

  it('rejects a traversal attempt using ../ segments to escape a known root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-safe2-'))
    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: `${toLibraryMediaUrl(root)}/%2E%2E/%2E%2E/etc/passwd` })
    expect(response.status).toBe(403)
  })

  it('resolves a fallback media file when the exact filename is missing in the folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-fallback-'))
    const songDir = path.join(root, 'Artist - Title')
    fs.mkdirSync(songDir, { recursive: true })
    const actualVideo = path.join(songDir, 'real-video.mp4')
    fs.writeFileSync(actualVideo, 'mp4-video-stream')

    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    // Request non-existent video.mp4 in that song directory
    const response = await handlers['aetherstar-media']({ url: toLibraryMediaUrl(path.join(songDir, 'video.mp4')) })
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe('mp4-video-stream')
  })

  it('returns 404 when a file does not exist and no fallback is found', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-missing-'))
    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: toLibraryMediaUrl(path.join(root, 'nonexistent.mp4')) })
    expect(response.status).toBe(404)
  })

  it('serves media through fileResponse with byte ranges, so far seeks do not restart the video', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-range-'))
    const video = path.join(root, 'clip.mp4')
    fs.writeFileSync(video, '0123456789abcdef')

    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const full = await handlers['aetherstar-media']({ url: toLibraryMediaUrl(video) })
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(full.headers.get('content-length')).toBe('16')

    const partial = await handlers['aetherstar-media']({
      url: toLibraryMediaUrl(video),
      headers: new Headers({ range: 'bytes=10-' }),
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 10-15/16')
    expect(partial.headers.get('content-length')).toBe('6')
    expect(await partial.text()).toBe('abcdef')

    const unsatisfiable = await handlers['aetherstar-media']({
      url: toLibraryMediaUrl(video),
      headers: new Headers({ range: 'bytes=99-' }),
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe('bytes */16')
  })

  it('answers 404 for a folder rather than trying to stream it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-media-dir-'))
    const songDir = path.join(root, 'Artist - Title')
    fs.mkdirSync(songDir)

    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({ getKnownRoots: () => [root], thumbnailsDir: '/thumbs' })

    const response = await handlers['aetherstar-media']({ url: toLibraryMediaUrl(songDir) })
    expect(response.status).toBe(404)
  })

  it('answers 500 rather than throwing when the root lookup itself fails', async () => {
    const { mod, handlers } = requireMediaProtocolWithMockedElectron()
    mod.registerMediaProtocol({
      getKnownRoots: () => {
        throw new Error('database is closed')
      },
      thumbnailsDir: '/thumbs',
    })

    const response = await handlers['aetherstar-media']({ url: 'aetherstar-media://roots/x.jpg' })
    expect(response.status).toBe(500)
  })
})
