import { describe, it, expect } from 'vitest'
import { toLibraryMediaUrl } from '../mediaUrl'

describe('toLibraryMediaUrl', () => {
  it('serves a POSIX path under the fixed "roots" host', () => {
    expect(toLibraryMediaUrl('/Users/me/Songs/A - B/cover.jpg')).toBe('aetherstar-media://roots/Users/me/Songs/A%20-%20B/cover.jpg')
  })

  // A raw `aetherstar-media://rootsD:\Songs...` parsed the drive letter as part
  // of the URL host and lost the path.
  it('keeps a Windows drive letter in the path, with forward slashes', () => {
    const url = toLibraryMediaUrl(String.raw`D:\Songs\Artist - Title\cover.jpg`)
    expect(url).toBe('aetherstar-media://roots/D:/Songs/Artist%20-%20Title/cover.jpg')
    expect(new URL(url).host).toBe('roots')
    expect(decodeURI(new URL(url).pathname)).toBe('/D:/Songs/Artist - Title/cover.jpg')
  })

  // `#` and `?` are legal in folder names and used to cut the path short as a
  // fragment or query.
  it('escapes characters that would otherwise end the path', () => {
    const url = toLibraryMediaUrl('/Songs/#1 Hit? (Live)/cover.jpg')
    expect(url).toBe('aetherstar-media://roots/Songs/%231%20Hit%3F%20(Live)/cover.jpg')
    expect(decodeURIComponent(new URL(url).pathname)).toBe('/Songs/#1 Hit? (Live)/cover.jpg')
  })

  it('encodes non-ASCII names', () => {
    expect(toLibraryMediaUrl('/Songs/Björk/cover.jpg')).toBe('aetherstar-media://roots/Songs/Bj%C3%B6rk/cover.jpg')
  })
})
