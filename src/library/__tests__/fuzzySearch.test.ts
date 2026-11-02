import { describe, it, expect } from 'vitest'
import { fuzzyFilter } from '../fuzzySearch'
import type { LibrarySong } from '../types'

function makeSong(overrides: Partial<LibrarySong>): LibrarySong {
  return {
    path: '/library/x',
    artist: 'Artist',
    title: 'Title',
    durationMs: 100,
    thumbnailPath: null,
    mp3Path: null,
  videoPath: null,
    bpm: 0,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: true,
    addedAt: 1,
    ...overrides,
  }
}

describe('fuzzyFilter', () => {
  it('finds a typo-tolerant match', () => {
    const songs = [makeSong({ artist: 'Nova Lane', title: 'Paper Satellites' }), makeSong({ artist: 'Someone Else', title: 'Other Song' })]
    const results = fuzzyFilter(songs, 'nva lane')
    expect(results.map((s) => s.artist)).toContain('Nova Lane')
  })

  it('returns the full list unchanged when the query is empty', () => {
    const songs = [makeSong({}), makeSong({ path: '/library/y' })]
    expect(fuzzyFilter(songs, '')).toEqual(songs)
  })
})
