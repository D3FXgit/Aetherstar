import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyseSongLoudness,
  clearSongGainCache,
  loadSongInfo,
  loadSongLoudness,
  measureSongFromBuffer,
  peekSongLoudness,
  rememberSongMeasurement,
  resolveSongGain,
  songFolderForMedia,
  songFolderKey,
  songFolderLookupCandidates,
  subscribeSongLoudness,
} from '../songGain'
import { dbToGain, UNMEASURED_GAIN_DB } from '../loudness'
import type { MeasurableBuffer } from '../loudnessMeter'
import { getSong } from '../../library/api'
import type { LibrarySong } from '../../library/types'

vi.mock('../../library/api', () => ({ getSong: vi.fn() }))

const getSongMock = vi.mocked(getSong)

const SONG_FOLDER = '/Users/me/Library/Kite Harbour - Tin Echo'
const PREVIEW_URL = `aetherstar-media://roots${SONG_FOLDER}/audio.mp3`

function librarySong(overrides: Partial<LibrarySong> = {}): LibrarySong {
  return {
    path: SONG_FOLDER,
    artist: 'Kite Harbour',
    title: 'Tin Echo',
    durationMs: 200_000,
    thumbnailPath: null,
    mp3Path: `${SONG_FOLDER}/audio.mp3`,
    videoPath: null,
    bpm: 0,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: true,
    addedAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  clearSongGainCache()
  getSongMock.mockReset()
})

/** Two seconds of a stereo 1 kHz tone at -12 dBFS: loud enough to measure, short enough to be quick. */
function toneBuffer(): MeasurableBuffer {
  const sampleRate = 48_000
  const data = new Float32Array(sampleRate * 2)
  for (let i = 0; i < data.length; i++) data[i] = 10 ** (-12 / 20) * Math.sin((2 * Math.PI * 1000 * i) / sampleRate)
  return { sampleRate, numberOfChannels: 2, length: data.length, getChannelData: () => data }
}

describe('songFolderForMedia', () => {
  it('takes the song folder from a library media URL', () => {
    expect(songFolderForMedia(PREVIEW_URL)).toBe(SONG_FOLDER)
  })

  it('decodes the escaping the URL had to apply to a real folder name', () => {
    expect(songFolderForMedia('aetherstar-media://roots/lib/Nico%20&%20Vinz%20-%20Am%20I%20Wrong/audio.mp3')).toBe(
      '/lib/Nico & Vinz - Am I Wrong',
    )
  })

  it('reads an encoded Windows URL: drive letter kept, URL slash dropped, %23 decoded', () => {
    expect(songFolderForMedia('aetherstar-media://roots/D:/Songs/a%23b/x.mp3')).toBe('D:/Songs/a#b')
    expect(songFolderForMedia('aetherstar-media://roots/D:/Songs/What%3F%20Me/x.mp3')).toBe('D:/Songs/What? Me')
  })

  it('reads the legacy shape with no slash after the host', () => {
    expect(songFolderForMedia('aetherstar-media://rootsD:\\Songs\\A - B\\x.mp3')).toBe('D:\\Songs\\A - B')
    expect(songFolderForMedia('aetherstar-media://roots/Users/me/A - B/x.mp3')).toBe('/Users/me/A - B')
  })

  it('reads stage media URLs too', () => {
    expect(songFolderForMedia('app-media://media/D:/Songs/A%20B/song.mp3')).toBe('D:/Songs/A B')
    expect(songFolderForMedia('app-media://exact/Users/me/A/vocals.mp3')).toBe('/Users/me/A')
  })

  it('survives a malformed escape rather than giving up', () => {
    expect(songFolderForMedia('aetherstar-media://roots/lib/100%/x.mp3')).toBe('/lib/100%')
  })

  it('does not treat a file at a drive root as a song folder', () => {
    expect(songFolderForMedia('aetherstar-media://roots/D:/x.mp3')).toBeNull()
  })

  it('refuses anything that is not library media, so the menu track costs no lookup', () => {
    // The privileged scheme is the only way library media reaches the renderer,
    // so everything else is by definition something else.
    expect(songFolderForMedia('/assets/menu_loop-a1b2c3.wav')).toBeNull()
    expect(songFolderForMedia('http://localhost:5173/assets/menu_loop.wav')).toBeNull()
    expect(songFolderForMedia('blob:nothing')).toBeNull()
    expect(songFolderForMedia('')).toBeNull()
    expect(songFolderForMedia(null)).toBeNull()
  })
})

describe('loadSongLoudness', () => {
  it('reads the stored measurement from the library index', async () => {
    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -5.9, truePeakDbtp: 3 }))

    await expect(loadSongLoudness(SONG_FOLDER)).resolves.toEqual({ loudnessLufs: -5.9, truePeakDbtp: 3 })
  })

  it('asks the main process once per song however many times it is asked', async () => {
    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -9 }))

    // Two concurrent asks, then a third after both settled: browsing back and
    // forth over the same songs must not be N IPC round trips.
    await Promise.all([loadSongLoudness(SONG_FOLDER), loadSongLoudness(SONG_FOLDER)])
    await loadSongLoudness(SONG_FOLDER)

    expect(getSongMock).toHaveBeenCalledTimes(1)
  })

  it('reports nothing known for a song the index has never seen', async () => {
    getSongMock.mockResolvedValue(null)
    await expect(loadSongLoudness(SONG_FOLDER)).resolves.toEqual({ loudnessLufs: null, truePeakDbtp: null })
  })

  it('survives a failed lookup, and does not poison the song for the rest of the session', async () => {
    getSongMock.mockRejectedValueOnce(new Error('IPC bridge missing'))
    await expect(loadSongLoudness(SONG_FOLDER)).resolves.toEqual({ loudnessLufs: null, truePeakDbtp: null })

    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -9 }))
    await expect(loadSongLoudness(SONG_FOLDER)).resolves.toEqual({ loudnessLufs: -9, truePeakDbtp: null })
  })
})

describe('peekSongLoudness', () => {
  it('returns nothing before the first lookup and the answer after it', async () => {
    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -9, truePeakDbtp: -1 }))

    expect(peekSongLoudness(SONG_FOLDER)).toBeNull()
    await loadSongLoudness(SONG_FOLDER)
    // This is what lets a remount open at the right level rather than at unity
    // and then correcting itself audibly.
    expect(peekSongLoudness(SONG_FOLDER)).toEqual({ loudnessLufs: -9, truePeakDbtp: -1 })
  })
})

describe('resolveSongGain', () => {
  it('turns a preview URL into that song s normalisation gain', async () => {
    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -6 }))
    // -6 LUFS against a -18 target: 12 dB down.
    await expect(resolveSongGain(PREVIEW_URL)).resolves.toBeCloseTo(10 ** (-12 / 20), 10)
  })

  it('returns unity for the menu track without touching the library at all', async () => {
    await expect(resolveSongGain('/assets/menu_loop-a1b2c3.wav')).resolves.toBe(1)
    expect(getSongMock).not.toHaveBeenCalled()
  })

  it('returns the conservative default for a song that has never been analysed', async () => {
    getSongMock.mockResolvedValue(librarySong())
    await expect(resolveSongGain(PREVIEW_URL)).resolves.toBeCloseTo(dbToGain(UNMEASURED_GAIN_DB), 10)
  })
})

describe('Windows folder keys', () => {
  it('collapses separators and drive-letter case into one cache key', () => {
    expect(songFolderKey('D:\\Songs\\A')).toBe(songFolderKey('d:/Songs/A/'))
    expect(songFolderKey('/Users/Me/A')).toBe('/Users/Me/A')
  })

  it('asks the index for the backslash spelling the scan worker stored', async () => {
    expect(songFolderLookupCandidates('D:/Songs/A')).toEqual(['D:/Songs/A', 'D:\\Songs\\A'])
    getSongMock.mockImplementation(async (path) => (path === 'D:\\Songs\\A' ? librarySong({ path, loudnessLufs: -9, truePeakDbtp: -1 }) : null))

    await expect(loadSongLoudness('D:/Songs/A')).resolves.toEqual({ loudnessLufs: -9, truePeakDbtp: -1 })
    // A URL-derived spelling and the stage's backslash spelling share the cache.
    expect(peekSongLoudness('D:\\Songs\\A')).toEqual({ loudnessLufs: -9, truePeakDbtp: -1 })
  })
})

describe('song info', () => {
  it('carries #PREVIEWSTART and the audio path from the index row', async () => {
    getSongMock.mockResolvedValue({ ...librarySong(), previewStartSec: 42.5 } as LibrarySong)
    await expect(loadSongInfo(SONG_FOLDER)).resolves.toMatchObject({ previewStartSec: 42.5, audioPath: `${SONG_FOLDER}/audio.mp3` })
  })

  it('ignores a nonsense preview start', async () => {
    getSongMock.mockResolvedValue({ ...librarySong(), previewStartSec: -3 } as LibrarySong)
    await expect(loadSongInfo(SONG_FOLDER)).resolves.toMatchObject({ previewStartSec: null })
  })
})

describe('renderer measurements', () => {
  it('measures a decoded buffer once, remembers it, and survives a restart via localStorage', async () => {
    getSongMock.mockResolvedValue(librarySong())
    const measured = await measureSongFromBuffer(SONG_FOLDER, toneBuffer())
    expect(measured?.loudnessLufs).toBeCloseTo(-12, 0)
    expect(peekSongLoudness(SONG_FOLDER)?.loudnessLufs).toBeCloseTo(-12, 0)

    // A new session: memory is gone, storage is not.
    clearSongGainCache()
    expect(peekSongLoudness(SONG_FOLDER)?.loudnessLufs).toBeCloseTo(-12, 0)
    await expect(loadSongLoudness(SONG_FOLDER)).resolves.toMatchObject({ loudnessLufs: expect.closeTo(-12, 0) })
  })

  it('prefers the index measurement over a renderer one', async () => {
    rememberSongMeasurement(SONG_FOLDER, { integratedLufs: -12, truePeakDbtp: -3 })
    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -9, truePeakDbtp: -1 }))
    await expect(loadSongLoudness(SONG_FOLDER)).resolves.toEqual({ loudnessLufs: -9, truePeakDbtp: -1 })
  })

  it('tells subscribers when a measurement lands', () => {
    const heard = vi.fn()
    const unsubscribe = subscribeSongLoudness(SONG_FOLDER, heard)
    rememberSongMeasurement(SONG_FOLDER, { integratedLufs: -10, truePeakDbtp: -2 })
    expect(heard).toHaveBeenCalledWith({ loudnessLufs: -10, truePeakDbtp: -2 })
    unsubscribe()
    rememberSongMeasurement(SONG_FOLDER, { integratedLufs: -11, truePeakDbtp: -2 })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('writes through to the library index when the main process offers it', () => {
    const setLoudness = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: unknown }).api = { library: { setLoudness } }
    try {
      rememberSongMeasurement(SONG_FOLDER, { integratedLufs: -10, truePeakDbtp: -2 })
      expect(setLoudness).toHaveBeenCalledWith(SONG_FOLDER, { integratedLufs: -10, truePeakDbtp: -2 })
    } finally {
      delete (window as unknown as { api?: unknown }).api
    }
  })

  it('analyses an unmeasured song from its index audio path, fetching it once', async () => {
    getSongMock.mockResolvedValue(librarySong())
    const fetchBytes = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const decode = vi.fn().mockResolvedValue(toneBuffer())

    const [first, second] = await Promise.all([
      analyseSongLoudness(SONG_FOLDER, { fetchBytes, decode }),
      analyseSongLoudness(SONG_FOLDER, { fetchBytes, decode }),
    ])
    expect(first?.loudnessLufs).toBeCloseTo(-12, 0)
    expect(second).toEqual(first)
    expect(fetchBytes).toHaveBeenCalledTimes(1)
    expect(fetchBytes.mock.calls[0][0]).toBe(`aetherstar-media://roots${SONG_FOLDER.replace(/ /g, '%20')}/audio.mp3`)
  })

  it('does not re-analyse a song that is already measured', async () => {
    getSongMock.mockResolvedValue(librarySong({ loudnessLufs: -9, truePeakDbtp: -1 }))
    const fetchBytes = vi.fn()
    await expect(analyseSongLoudness(SONG_FOLDER, { fetchBytes })).resolves.toEqual({ loudnessLufs: -9, truePeakDbtp: -1 })
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('resolves null rather than rejecting when the audio cannot be read', async () => {
    getSongMock.mockResolvedValue(librarySong())
    const fetchBytes = vi.fn().mockRejectedValue(new Error('gone'))
    await expect(analyseSongLoudness(SONG_FOLDER, { fetchBytes })).resolves.toBeNull()
  })
})
