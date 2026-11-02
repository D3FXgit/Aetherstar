import { describe, expect, it } from 'vitest'
import { dirnameOf, resolveBackgroundUrl, resolveCoverUrl, resolveMediaPath, toAppMediaUrl } from '../resolveMediaPath'

describe('dirnameOf', () => {
  it('returns the directory portion of an absolute path', () => {
    expect(dirnameOf('/Users/x/fixtures/sample-song/notes.txt')).toBe('/Users/x/fixtures/sample-song')
  })
})

describe('toAppMediaUrl', () => {
  it('prefixes the scheme with a fixed "media" host ahead of the path, then encodes the path', () => {
    expect(toAppMediaUrl('/a/b.mp3')).toBe('app-media://media/a/b.mp3')
  })

  // Verified against a real Electron process (Node's own URL parser does not
  // reproduce this -- that gap is exactly how it shipped unnoticed): without
  // a fixed host ahead of the path, Chromium's URL parser for a "standard"
  // privileged scheme reads an absolute Unix path's own leading segment
  // ("Users") as the URL's *authority*, silently dropping the leading slash
  // and lowercasing it -- every real song's chart/media load failed with
  // net::ERR_FILE_NOT_FOUND because of this. `aetherstar-media://roots<path>`
  // (the library's media scheme) already sidesteps it with a fixed host; this
  // scheme now does too.
  it('gives the URL a fixed host so a leading path segment is never misread as the authority', () => {
    const url = toAppMediaUrl('/Users/x/song.mp3')
    const parsed = new URL(url)
    expect(parsed.host).toBe('media')
    expect(parsed.pathname).toBe('/Users/x/song.mp3')
  })

  it('escapes a literal "#" so it is not misread as the URL fragment separator, truncating the rest of the path', () => {
    // UltraStar's own convention: "#VIDEO:Artist - Title [VD#1].mpg"
    const url = toAppMediaUrl('/Users/x/song/Artist - Title [VD#1].mpg')
    expect(url).not.toContain('#')
    expect(new URL(url).pathname).toBe('/Users/x/song/Artist%20-%20Title%20%5BVD%231%5D.mpg')
  })

  it('normalizes Windows drive letter paths with a leading slash to preserve hostname', () => {
    const url = toAppMediaUrl('C:\\Songs\\rock\\song.mp3')
    const parsed = new URL(url)
    expect(parsed.host).toBe('media')
    expect(parsed.pathname).toBe('/C:/Songs/rock/song.mp3')
  })
})

describe('resolveMediaPath', () => {
  it('joins the source directory and relative filename into an encoded app-media URL', () => {
    const url = resolveMediaPath(
      '/Users/x/fixtures/sample-song',
      'Nova Lane - Paper Satellites.mp3',
    )
    expect(url).toBe(
      'app-media://media/Users/x/fixtures/sample-song/Nova%20Lane%20-%20Paper%20Satellites.mp3',
    )
  })

  it('returns null when no relative filename is given', () => {
    expect(resolveMediaPath('/Users/x/fixtures/sample-song', undefined)).toBeNull()
  })
})

describe('resolveCoverUrl / resolveBackgroundUrl', () => {
  const META = { artist: 'Mira Castell', title: 'Orbit Seven' }

  it('uses the #COVER tag when there is one', () => {
    expect(resolveCoverUrl('/songs/orbit', { ...META, coverPath: 'cover.jpg' })).toBe('app-media://media/songs/orbit/cover.jpg')
  })

  // Charts often carry no #COVER and just leave `..._cover.jpg` in the folder.
  // The conventional name lets the app-media handler serve it, or the folder's
  // first image -- the picture the scanner made the song's thumbnail from.
  it('without #COVER, asks for the conventional [CO] name so the handler can fall back to the folder image', () => {
    expect(resolveCoverUrl('/songs/orbit', META)).toBe(
      `app-media://media/songs/orbit/${encodeURI('Mira Castell - Orbit Seven [CO].jpg')}`,
    )
    expect(resolveCoverUrl('/songs/x', { artist: 'TX/RX', title: 'R.E.D?' })).toContain(encodeURI('TXRX - R.E.D [CO].jpg'))
  })

  it('resolves #BACKGROUND, and never guesses one', () => {
    expect(resolveBackgroundUrl('/songs/orbit', { backgroundPath: 'Orbit Seven [BG].jpg' })).toBe(
      `app-media://media/songs/orbit/${encodeURI('Orbit Seven [BG].jpg')}`,
    )
    expect(resolveBackgroundUrl('/songs/orbit', {})).toBeNull()
  })
})
