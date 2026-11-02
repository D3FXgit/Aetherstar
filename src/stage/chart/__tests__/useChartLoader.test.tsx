import { describe, expect, it, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { prefetchChart, resetChartCacheForTests, useChartLoader } from '../useChartLoader'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/sample-song/notes.txt',
)
const raw = readFileSync(FIXTURE_PATH, 'utf-8')
const ABSOLUTE_TXT_PATH = '/abs/fixtures/sample-song/notes.txt'

/**
 * The loader reads chart *bytes*, not `response.text()` -- that method is a
 * hard-wired UTF-8 decode and real libraries are full of windows-1252 files
 * (see decodeChartBytes). These mocks therefore answer with an ArrayBuffer,
 * exactly as a real Response does.
 */
function respondWith(text: string, init: Record<string, unknown> = {}) {
  return { ok: true, ...init, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer) }
}

describe('useChartLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetChartCacheForTests()
  })

  /**
   * Starting one song used to fetch and parse the same .txt twice --
   * SessionPlay loads it for the best-line tally and the Sing it renders loads
   * it again for the stage -- both on the critical path between the countdown
   * ending and the stage appearing, and both through the `app-media://`
   * handler, which stats the path and reads its directory on every request.
   */
  it('serves a second consumer of the same chart from cache, without a second fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respondWith(raw))
    vi.stubGlobal('fetch', fetchMock)

    const first = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    // Ready on the very first render -- no 'loading' flash for the second consumer.
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.chart?.meta.artist).toBe('AetherStar')
    expect(second.result.current.sourceDir).toBe('/abs/fixtures/sample-song')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * SessionPlay and the Sing it renders ask for the same chart in the same
   * commit, so neither can see the other's cache entry yet -- the cache alone
   * would only ever have helped the *next* song.
   */
  it('shares one in-flight load between two consumers mounted in the same tick', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respondWith(raw))
    vi.stubGlobal('fetch', fetchMock)

    const a = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))
    const b = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(a.result.current.status).toBe('ready'))
    await waitFor(() => expect(b.result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The same parsed chart object, not two equal ones -- one parse, not two.
    expect(b.result.current.chart).toBe(a.result.current.chart)
  })

  it('prefetches a chart so a later consumer is ready without its own fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respondWith(raw))
    vi.stubGlobal('fetch', fetchMock)

    prefetchChart(ABSOLUTE_TXT_PATH)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures, so a transient error stays retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const failed = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))
    await waitFor(() => expect(failed.result.current.status).toBe('error'))

    const fetchMock = vi.fn().mockResolvedValue(respondWith(raw))
    vi.stubGlobal('fetch', fetchMock)
    const retried = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(retried.result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is idle when given no path, and never fetches', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChartLoader(null))

    expect(result.current).toEqual({ status: 'idle', chart: null, sourceDir: null, error: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches, parses, and resolves the source directory once a path is given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respondWith(raw)),
    )

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.chart?.meta.artist).toBe('AetherStar')
    expect(result.current.sourceDir).toBe('/abs/fixtures/sample-song')
    expect(result.current.error).toBeNull()
  })

  // Regression: playback used to read the body with `response.text()`, a
  // hard-wired UTF-8 decode. Real UltraStar libraries are full of
  // windows-1252 charts, and every umlaut in their lyrics reached the stage as
  // U+FFFD -- while the scan-time parser, which always sniffed the encoding,
  // indexed them correctly. A song was indexed as "Grüße" and sung as "Gr<?><?>e".
  it('decodes a windows-1252 chart body instead of filling the lyrics with U+FFFD', async () => {
    const cp1252 = new Uint8Array([
      ...new TextEncoder().encode('#ARTIST:Maerzwind\n#TITLE:Fluss\n#MP3:s.mp3\n#BPM:212,5\n#GAP:0\n: 0 2 11 Gr'),
      0xfc, // 'ü' in windows-1252 -- not valid standalone UTF-8
      0xdf, // 'ß'
      ...new TextEncoder().encode('e\nE\n'),
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(cp1252.buffer) }))

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.chart?.lines[0].notes[0].syllable).toBe('Grüße')
    expect(result.current.chart?.meta.bpm).toBe(212.5)
  })

  it('reports an error state when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.chart).toBeNull()
    expect(result.current.error).toContain('boom')
  })

  // app-media:// resolves a song *folder* to the .txt inside it, and falls
  // back by extension when a #MP3/#VIDEO tag is stale. When neither resolves,
  // the handler can answer with a non-2xx response (or a directory listing)
  // rather than rejecting -- `response.text()` then succeeds and the old code
  // happily "parsed" the error body into an empty chart with bpm 0 and no
  // audio, reporting status 'ready'. The Stage then mounted and sat in a
  // countdown forever with no error anywhere.
  it('treats a non-OK response as an error instead of parsing the error body as a chart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respondWith('<html>not found</html>', { ok: false, status: 404, statusText: 'Not Found' })),
    )

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.chart).toBeNull()
    expect(result.current.error).toContain('404')
  })

  it('reports a clean error (never an uncaught throw) for a chart with no singable notes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respondWith('#TITLE:Header only\n#BPM:250\n')),
    )

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatch(/no note lines/i)
  })

  it('reports a clean error for a chart whose BPM is missing or unusable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respondWith('#TITLE:No tempo\n: 0 3 65 Hi\nE\n')),
    )

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatch(/bpm/i)
  })

  it('surfaces a parser throw as status "error", never as an uncaught rejection', async () => {
    vi.stubGlobal(
      'fetch',
      // `arrayBuffer()` itself rejecting stands in for any post-fetch failure
      // in the parse step -- the same .catch has to absorb both.
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.reject(new TypeError('decode failed')) }),
    )

    const { result } = renderHook(() => useChartLoader(ABSOLUTE_TXT_PATH))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('decode failed')
  })
})
