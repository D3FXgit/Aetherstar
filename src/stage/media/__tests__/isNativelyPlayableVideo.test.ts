import { describe, expect, it } from 'vitest'
import { isNativelyPlayableVideo } from '../isNativelyPlayableVideo'

describe('isNativelyPlayableVideo', () => {
  it('rejects the real fixture chart\'s .mpg video (not Chromium-native)', () => {
    expect(isNativelyPlayableVideo('Nova Lane - Paper Satellites [VD#1].mpg')).toBe(false)
  })

  it('accepts .mp4 and .webm', () => {
    expect(isNativelyPlayableVideo('song.mp4')).toBe(true)
    expect(isNativelyPlayableVideo('song.webm')).toBe(true)
  })

  it('treats a missing path as not playable', () => {
    expect(isNativelyPlayableVideo(undefined)).toBe(false)
  })
})
