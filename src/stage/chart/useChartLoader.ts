import { useEffect, useState } from 'react'
import type { SongChart } from '../../contracts/types'
import { logSongLoad, logSongLoadError, toError } from '../../diagnostics/log'
import { dirnameOf, toAppMediaUrl, RESOLVED_PATH_HEADER } from '../media/resolveMediaPath'
import { decodeChartBytes } from './decodeChartBytes'
import { parseChartWithWarnings } from './parseChartText'

interface ChartLoadResult {
  status: 'idle' | 'loading' | 'ready' | 'error'
  chart: SongChart | null
  sourceDir: string | null
  error: string | null
}

const IDLE_RESULT: ChartLoadResult = { status: 'idle', chart: null, sourceDir: null, error: null }

/**
 * Successfully-parsed charts, keyed by the path that was asked for.
 *
 * Starting one song fetched and parsed the same .txt twice: `SessionPlay`
 * loads it for the best-line tally and `Sing`, which it renders, loads it
 * again for the stage -- two round-trips through the `app-media://` handler
 * (which stats the path and reads the directory on every request) and two
 * parses of the same bytes, on the critical path between the countdown ending
 * and the stage appearing. A remount of either -- which the session does when
 * a player backs out and restarts a song -- paid for it a third and fourth
 * time.
 *
 * Small and bounded: a chart is a few kilobytes, and a party never has more
 * than a handful of songs in flight. Entries are never invalidated within a
 * session, which is correct for a library the app is not editing.
 */
const CHART_CACHE_LIMIT = 8
const chartCache = new Map<string, ChartLoadResult>()

function readCache(absoluteTxtPath: string): ChartLoadResult | null {
  const cached = chartCache.get(absoluteTxtPath)
  if (!cached) return null
  // Re-insert so the map's own insertion order is the LRU order.
  chartCache.delete(absoluteTxtPath)
  chartCache.set(absoluteTxtPath, cached)
  return cached
}

function writeCache(absoluteTxtPath: string, result: ChartLoadResult): void {
  chartCache.set(absoluteTxtPath, result)
  while (chartCache.size > CHART_CACHE_LIMIT) {
    const oldest = chartCache.keys().next()
    if (oldest.done) break
    chartCache.delete(oldest.value)
  }
}

/**
 * For tests only: the cache is a module-level singleton that deliberately
 * outlives any React tree, so it also outlives a test's `fetch` stub.
 */
export function resetChartCacheForTests(): void {
  chartCache.clear()
}

/**
 * Everything downstream of here (Stage's clock, Gameplay's judging, the lyric
 * sweep) assumes a usable tempo and at least one note. A chart missing either
 * cannot be sung at all; rejecting it here shows Sing's error state instead of
 * a stage stuck in its countdown.
 */
function assertPlayable(chart: SongChart): void {
  if (!Number.isFinite(chart.meta.bpm) || chart.meta.bpm <= 0) {
    throw new Error(`Chart has no usable BPM (got ${String(chart.meta.bpm)}) — the #BPM tag is missing or unreadable.`)
  }
  if (chart.lines.length === 0) {
    throw new Error('Chart has no note lines — the file parsed, but contains nothing singable.')
  }
}

/**
 * Loads in flight, keyed by path.
 *
 * `SessionPlay` and the `Sing` it renders both ask for the same chart in the
 * same commit, so neither can see the other's cache entry yet -- without this
 * they still fire two fetches and two parses, and the cache only ever helps
 * the *next* song. Sharing the promise makes the second caller wait on the
 * first caller's work instead of repeating it.
 */
const inFlight = new Map<string, Promise<ChartLoadResult>>()

/** The whole fetch -> decode -> parse -> validate pipeline, cached and de-duplicated. */
function loadChart(absoluteTxtPath: string): Promise<ChartLoadResult> {
  const shared = inFlight.get(absoluteTxtPath)
  if (shared) return shared

  const url = toAppMediaUrl(absoluteTxtPath)
  logSongLoad('chart:path-received', { absoluteTxtPath, sourceDir: dirnameOf(absoluteTxtPath) })
  logSongLoad('chart:fetch-start', { url })

  // The handler reports which file it actually served. A library song's
  // path is its *folder*, so the chart lives one level deeper than the
  // requested path -- deriving the media directory from the request alone
  // pointed at the library root and broke every #MP3/#VIDEO lookup.
  let resolvedSourceDir = dirnameOf(absoluteTxtPath)

  const pending = fetch(url)
    .then((response) => {
      // Optional-chained: the header is an enhancement, and the
      // dirnameOf() fallback above stays correct without it.
      const resolvedPath = response.headers?.get(RESOLVED_PATH_HEADER)
      if (resolvedPath) resolvedSourceDir = dirnameOf(decodeURIComponent(resolvedPath))
      logSongLoad('chart:fetch-response', { url, ok: response.ok, status: response.status, statusText: response.statusText, resolvedSourceDir })
      // Without this, a non-2xx answer from the app-media:// handler (a
      // stale #MP3 tag, a song folder with no .txt, a directory listing)
      // still resolved -- `text()` returned the error body, which "parsed"
      // into an empty chart and reported status 'ready'.
      if (!response.ok) {
        throw new Error(`Chart request failed: ${response.status} ${response.statusText ?? ''}`.trim())
      }
      // Deliberately NOT response.text(): that is a hard-wired UTF-8 decode,
      // and real UltraStar libraries are full of windows-1252 files (see
      // fixtures/cp1252-song/). Every umlaut in the lyrics arrived
      // as U+FFFD while the scan-time parser -- which always did sniff the
      // encoding -- had the same text right. decodeChartBytes is that same
      // sniffing step, and the two are pinned together by
      // src/stage/chart/__tests__/parserEquivalence.test.ts.
      //
      // `text()` remains as a fallback for any Response-like object that
      // cannot hand over bytes; that path is simply the old UTF-8-only
      // behaviour, which is still better than failing the load outright.
      const body: Promise<ArrayBuffer | string> =
        typeof response.arrayBuffer === 'function' ? response.arrayBuffer() : response.text()
      return body
    })
    .then((body): ChartLoadResult => {
      const raw = typeof body === 'string' ? body : decodeChartBytes(new Uint8Array(body))
      logSongLoad('chart:parse-start', { url, bytes: raw.length })
      const { chart, warnings } = parseChartWithWarnings(raw)
      assertPlayable(chart)
      // Skipped lines are recovered from, never swallowed: the scan path
      // records the identical strings as scan errors (scan-worker.cjs), and
      // playback puts them in the same song-load trace as everything else.
      if (warnings.length > 0) {
        logSongLoad('chart:parse-warnings', { url, warningCount: warnings.length, warnings: warnings.slice(0, 20) })
      }
      logSongLoad('chart:parse-ok', {
        title: chart.meta.title,
        artist: chart.meta.artist,
        bpm: chart.meta.bpm,
        gap: chart.meta.gap,
        videoGap: chart.meta.videoGap,
        lineCount: chart.lines.length,
        noteCount: chart.lines.reduce((total, line) => total + line.notes.length, 0),
        mp3Tag: chart.meta.mp3Path,
        videoTag: chart.meta.videoPath ?? null,
      })
      const ready: ChartLoadResult = { status: 'ready', chart, sourceDir: resolvedSourceDir, error: null }
      // Only successes are cached: an error is very often transient (a file
      // still being written, a disconnected drive) and must stay retryable.
      writeCache(absoluteTxtPath, ready)
      return ready
    })
    // One catch for every post-fetch failure class: a rejected fetch, a
    // non-OK response, a decode failure, and any throw out of
    // parseChartText/assertPlayable. Nothing in this chain can escape as an
    // unhandled rejection or an uncaught render-phase throw.
    .catch((error: unknown): ChartLoadResult => {
      logSongLoadError('chart', error, { url, absoluteTxtPath })
      return { status: 'error', chart: null, sourceDir: null, error: toError(error).message }
    })
    .finally(() => {
      inFlight.delete(absoluteTxtPath)
    })

  inFlight.set(absoluteTxtPath, pending)
  return pending
}

/**
 * Starts a chart loading without rendering anything.
 *
 * The song-start transition owns the screen for its full measured 4750ms while
 * nothing at all happens on the song's behalf: the chart was only fetched,
 * decoded and parsed once `session-play` mounted, *after* the countdown had
 * already finished -- so the first thing the player saw after "1" was a
 * "Loading..." panel. Warming the cache during the transition moves that work
 * into time the user is already spending, and `Sing` then mounts with the
 * chart in hand.
 *
 * Deliberately fire-and-forget: a prefetch that fails changes nothing, because
 * failures are not cached and the real load will surface the error properly.
 */
export function prefetchChart(absoluteTxtPath: string | null | undefined): void {
  if (!absoluteTxtPath || chartCache.has(absoluteTxtPath)) return
  logSongLoad('chart:prefetch', { absoluteTxtPath })
  void loadChart(absoluteTxtPath).catch(() => {})
}

/** Fetches a chart's raw text over app-media://, parses it, and resolves its source directory. */
export function useChartLoader(absoluteTxtPath: string | null): ChartLoadResult {
  // Seeded from the cache so a second consumer of the same chart -- or one
  // mounting after the transition prefetched it -- is 'ready' on its very
  // first render, with no 'loading' flash.
  const [result, setResult] = useState<ChartLoadResult>(
    () => (absoluteTxtPath ? readCache(absoluteTxtPath) : null) ?? IDLE_RESULT,
  )

  useEffect(() => {
    if (!absoluteTxtPath) {
      setResult(IDLE_RESULT)
      return
    }

    const cached = readCache(absoluteTxtPath)
    if (cached) {
      logSongLoad('chart:cache-hit', { absoluteTxtPath, sourceDir: cached.sourceDir })
      setResult(cached)
      return
    }

    let cancelled = false
    setResult({ status: 'loading', chart: null, sourceDir: null, error: null })

    void loadChart(absoluteTxtPath).then((next) => {
      if (!cancelled) setResult(next)
    })

    return () => {
      cancelled = true
    }
  }, [absoluteTxtPath])

  return result
}
