// Scan-time EBU R 128 loudness measurement for the per-song normalisation gain
// (see src/audio/loudness.ts). Measured once at scan time, off the song-start
// path; `ebur128` rather than `loudnorm`, which agrees to 0.05 dB but is ~6x slower.
const { spawn: nodeSpawn } = require('node:child_process')

/**
 * `framelog=verbose` is what keeps this cheap to read: without it the filter
 * logs one line per 100 ms of audio (2252 lines for a 3'45" song) at the same
 * level as the summary. At `verbose` those per-frame lines drop below ffmpeg's
 * default log level and only the ~40-line summary is left on stderr.
 */
const EBUR128_FILTER = 'ebur128=peak=true:framelog=verbose'

/** The candidate that answered `-version`, once `resolveFfmpeg` has found one. */
let resolvedCommand = null

/** Enough stderr to hold the summary block many times over, and bounded so a chatty/looping decode cannot grow without limit. */
const MAX_STDERR_BYTES = 64 * 1024

/** A single file should never take minutes. A hung/garbage decode is killed and reported as "no measurement" rather than stalling the scan. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Pulls integrated loudness and true peak out of the `ebur128` summary block:
 *
 *   Summary:
 *
 *     Integrated loudness:
 *       I:         -14.7 LUFS
 *       Threshold: -24.8 LUFS
 *     ...
 *     True peak:
 *       Peak:       -1.2 dBFS
 *
 * Anchored on "Summary:" on purpose. Even with `framelog=verbose` a caller
 * running ffmpeg at a higher verbosity would put per-frame `I:`/`TPK:` values
 * on stderr too, and those are running values for one 100 ms window -- reading
 * one of those as the integrated loudness would be silently, badly wrong.
 *
 * @returns {{ integratedLufs: number, truePeakDbtp: number } | null}
 */
function parseEbur128Summary(stderr) {
  const summaryIndex = stderr.lastIndexOf('Summary:')
  if (summaryIndex === -1) return null
  const summary = stderr.slice(summaryIndex)

  const integrated = summary.match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/)
  const peak = summary.match(/True peak:\s*\n\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/)
  if (!integrated || !peak) return null

  const integratedLufs = Number(integrated[1])
  const truePeakDbtp = Number(peak[1])
  // A file of digital silence measures -inf, which ffmpeg prints as a very
  // large negative number. Storing that would ask playback for an absurd boost
  // -- which the gain function clamps anyway, but a measurement nobody can act
  // on is better recorded as "not measured".
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) return null
  if (integratedLufs < -70) return null

  return { integratedLufs, truePeakDbtp }
}

/**
 * Where to look for ffmpeg, in order.
 *
 * `AETHERSTAR_FFMPEG` first, so a packaged build can point at a bundled binary
 * without this file having to know how it was packaged. Then the bare name, for
 * a system install on PATH -- which covers every developer run and every launch
 * from a shell.
 *
 * The absolute paths after it are not redundant. A macOS app launched from
 * Finder inherits `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so a
 * Homebrew ffmpeg (`/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on
 * Intel) is invisible to a bare `spawn('ffmpeg')` even though the same command
 * works perfectly in the user's terminal. Naming them is the difference between
 * the feature working and silently doing nothing for most Mac users.
 */
function ffmpegCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    // Windows has no single install location either, and an app started from
    // the Start menu sees the PATH it was given at login -- a winget or scoop
    // install made since then is not on it. These are where the common package
    // managers put the binary (or a shim to it). When none is found, the
    // renderer still measures each song itself (src/audio/loudnessMeter.ts).
    const localAppData = env.LOCALAPPDATA
    const userProfile = env.USERPROFILE
    const programData = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData'
    return [
      env.AETHERSTAR_FFMPEG,
      'ffmpeg',
      localAppData && `${localAppData}\\Microsoft\\WinGet\\Links\\ffmpeg.exe`,
      userProfile && `${userProfile}\\scoop\\shims\\ffmpeg.exe`,
      `${programData}\\chocolatey\\bin\\ffmpeg.exe`,
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    ].filter(Boolean)
  }
  return [
    env.AETHERSTAR_FFMPEG,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean)
}

/**
 * Integrated loudness + true peak for one audio file, or null.
 *
 * **Never throws and never rejects.** Every failure mode -- no ffmpeg
 * installed, an unreadable/undecodable file, a non-zero exit, a timeout,
 * unparseable output -- resolves to null, which the caller stores as "no
 * measurement" and playback reads as "play this song exactly as loud as it is".
 * A library scan must not be able to fail over a loudness measurement.
 *
 * @param {string} audioPath
 * @param {{ spawn?: Function, command?: string, timeoutMs?: number }} [options] seams for tests
 * @returns {Promise<{ integratedLufs: number, truePeakDbtp: number } | null>}
 */
function measureLoudness(audioPath, options = {}) {
  // `resolvedCommand` is whichever candidate answered `-version` during the
  // pass's one-off probe, so every song after the first is spawned against a
  // binary already known to exist. Falling back to the first candidate keeps a
  // direct call (a script, a test) working without a probe.
  const { spawn = nodeSpawn, command = resolvedCommand ?? ffmpegCandidates()[0], timeoutMs = DEFAULT_TIMEOUT_MS } = options

  return new Promise((resolve) => {
    let settled = false
    // Declared ahead of `finish`: the spawn-throws path below calls `finish`
    // before the timer exists, and `clearTimeout(undefined)` is a no-op while
    // reading an uninitialised `const` is a ReferenceError.
    let timer
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    let child
    try {
      child = spawn(
        command,
        [
          // No stdin: ffmpeg reading from a closed/absent stdin inside a worker
          // is a well-known way to hang forever.
          '-nostdin',
          '-hide_banner',
          '-nostats',
          '-i',
          audioPath,
          '-af',
          EBUR128_FILTER,
          '-f',
          'null',
          '-',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
    } catch {
      // Spawn itself threw -- no ffmpeg on this machine.
      finish(null)
      return
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
      finish(null)
    }, timeoutMs)
    // A pending timer must never be the reason an Electron main process or a
    // worker refuses to exit.
    if (typeof timer.unref === 'function') timer.unref()

    let stderr = ''
    child.stderr?.setEncoding?.('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > MAX_STDERR_BYTES) stderr = stderr.slice(-MAX_STDERR_BYTES)
    })

    // 'error' fires for ENOENT (ffmpeg not installed) among others.
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 ? parseEbur128Summary(stderr) : null))
  })
}

function probe(spawn, command) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * The first candidate that actually answers `-version`, or null, cached for the
 * life of the process.
 *
 * Resolved once before a loudness pass so a machine with no ffmpeg skips the
 * whole pass instead of spawning (and failing) once per song, and so a machine
 * that has one only at an absolute path pays for the search exactly once.
 */
let ffmpegResolution = null
function resolveFfmpeg(options = {}) {
  const { spawn = nodeSpawn, candidates = ffmpegCandidates(), force = false } = options
  if (!force && ffmpegResolution) return ffmpegResolution

  ffmpegResolution = (async () => {
    for (const candidate of candidates) {
      if (await probe(spawn, candidate)) {
        resolvedCommand = candidate
        return candidate
      }
    }
    return null
  })()
  return ffmpegResolution
}

/** As `resolveFfmpeg`, reduced to the yes/no the scan pass gates on. */
async function isFfmpegAvailable(options = {}) {
  return (await resolveFfmpeg(options)) !== null
}

/** Test seam: forget the cached resolution. */
function resetFfmpegAvailability() {
  ffmpegResolution = null
  resolvedCommand = null
}

module.exports = {
  EBUR128_FILTER,
  DEFAULT_TIMEOUT_MS,
  ffmpegCandidates,
  resolveFfmpeg,
  parseEbur128Summary,
  measureLoudness,
  isFfmpegAvailable,
  resetFfmpegAvailability,
}
