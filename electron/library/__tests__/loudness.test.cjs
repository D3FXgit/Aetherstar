// @vitest-environment node
const { EventEmitter } = require('node:events')
const { parseEbur128Summary, measureLoudness, ffmpegCandidates, resolveFfmpeg, resetFfmpegAvailability } = require('../loudness.cjs')

/**
 * A real `ffmpeg -af ebur128` summary, copied verbatim from a run against a
 * full-length song in a local library -- the point of a fixture here is
 * that it is byte-for-byte what the tool actually prints, not a tidied-up
 * approximation of it.
 */
const REAL_SUMMARY = `[Parsed_ebur128_0 @ 0x94d031200] Summary:

  Integrated loudness:
    I:         -17.2 LUFS
    Threshold: -27.4 LUFS

  Loudness range:
    LRA:         8.2 LU
    Threshold: -37.6 LUFS
    LRA low:   -22.7 LUFS
    LRA high:  -14.5 LUFS

  True peak:
    Peak:       -0.1 dBFS

[out#0/null @ 0x94d0309c0] video:0KiB audio:38779KiB subtitle:0KiB other streams:0KiB
`

/** One per-frame log line, which is what the parser must not mistake for the integrated value. */
const FRAME_LINE =
  '[Parsed_ebur128_0 @ 0x94d031200] t: 12.3 TARGET:-23 LUFS    M: -41.6 S: -33.7     I: -6.6 LUFS       LRA:   4.6 LU  FTPK: -28.9 -32.9 dBFS  TPK:  -1.2  -1.4 dBFS\n'

describe('parseEbur128Summary', () => {
  it('reads integrated loudness and true peak out of a real summary block', () => {
    expect(parseEbur128Summary(REAL_SUMMARY)).toEqual({ integratedLufs: -17.2, truePeakDbtp: -0.1 })
  })

  it('reads the summary, never a per-frame running value', () => {
    // The running `I:` of one 100 ms window is not the integrated loudness of
    // the file, and reading one would be silently, badly wrong -- here it would
    // claim -6.6 LUFS for a song that measures -17.2.
    expect(parseEbur128Summary(FRAME_LINE.repeat(50) + REAL_SUMMARY)).toEqual({
      integratedLufs: -17.2,
      truePeakDbtp: -0.1,
    })
  })

  it('reads positive true peaks, which most modern masters have', () => {
    const hot = REAL_SUMMARY.replace('Peak:       -0.1 dBFS', 'Peak:        3.0 dBFS')
    expect(parseEbur128Summary(hot)?.truePeakDbtp).toBe(3)
  })

  it('returns nothing rather than guessing when the output is not a summary', () => {
    expect(parseEbur128Summary('')).toBeNull()
    expect(parseEbur128Summary(FRAME_LINE)).toBeNull()
    expect(parseEbur128Summary('Summary:\n\n  nothing useful here\n')).toBeNull()
  })

  it('treats a file of digital silence as unmeasured rather than storing an absurd boost', () => {
    const silent = REAL_SUMMARY.replace('I:         -17.2 LUFS', 'I:         -70.1 LUFS')
    expect(parseEbur128Summary(silent)).toBeNull()
  })
})

/** A minimal stand-in for a spawned process, with an attached stderr stream. */
function fakeChild() {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stderr.setEncoding = () => {}
  child.kill = () => {}
  return child
}

describe('measureLoudness', () => {
  it('measures a file by running the ebur128 filter over it', async () => {
    const child = fakeChild()
    let args = null
    const spawn = (_command, spawnArgs) => {
      args = spawnArgs
      return child
    }

    const promise = measureLoudness('/library/song/audio.mp3', { spawn })
    child.stderr.emit('data', REAL_SUMMARY)
    child.emit('close', 0)

    await expect(promise).resolves.toEqual({ integratedLufs: -17.2, truePeakDbtp: -0.1 })
    expect(args).toContain('/library/song/audio.mp3')
    // -nostdin: ffmpeg reading a closed stdin inside a worker is a classic hang.
    expect(args).toContain('-nostdin')
    // framelog=verbose is what keeps ~2250 per-frame lines off stderr.
    expect(args.join(' ')).toContain('framelog=verbose')
  })

  // Every one of these is "the song keeps a null measurement and plays at
  // exactly the level it plays at today". A library scan must not be able to
  // fail over a loudness measurement.
  describe('never fails the scan', () => {
    it('resolves null when ffmpeg is not installed', async () => {
      const child = fakeChild()
      const promise = measureLoudness('/song.mp3', { spawn: () => child })
      child.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))
      await expect(promise).resolves.toBeNull()
    })

    it('resolves null when spawn itself throws', async () => {
      await expect(
        measureLoudness('/song.mp3', {
          spawn: () => {
            throw new Error('no child processes here')
          },
        }),
      ).resolves.toBeNull()
    })

    it('resolves null on a non-zero exit, even if something summary-shaped was printed', async () => {
      const child = fakeChild()
      const promise = measureLoudness('/song.mp3', { spawn: () => child })
      child.stderr.emit('data', REAL_SUMMARY)
      child.emit('close', 1)
      await expect(promise).resolves.toBeNull()
    })

    it('resolves null on unparseable output', async () => {
      const child = fakeChild()
      const promise = measureLoudness('/song.mp3', { spawn: () => child })
      child.stderr.emit('data', 'Invalid data found when processing input\n')
      child.emit('close', 0)
      await expect(promise).resolves.toBeNull()
    })

    it('kills and gives up on a decode that never finishes', async () => {
      vi.useFakeTimers()
      try {
        const child = fakeChild()
        let killed = false
        child.kill = () => {
          killed = true
        }

        const promise = measureLoudness('/song.mp3', { spawn: () => child, timeoutMs: 1000 })
        vi.advanceTimersByTime(1001)

        await expect(promise).resolves.toBeNull()
        expect(killed).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('settles exactly once when a timeout and a close race each other', async () => {
      vi.useFakeTimers()
      try {
        const child = fakeChild()
        const promise = measureLoudness('/song.mp3', { spawn: () => child, timeoutMs: 1000 })
        vi.advanceTimersByTime(1001)
        child.stderr.emit('data', REAL_SUMMARY)
        child.emit('close', 0)
        // The timeout won; a late success must not overwrite the answer.
        await expect(promise).resolves.toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('bounds how much stderr it retains, so a chatty decode cannot grow without limit', async () => {
    const child = fakeChild()
    const promise = measureLoudness('/song.mp3', { spawn: () => child })

    // 5 MB of per-frame spam, then the summary. The summary is at the end, so
    // a tail-bounded buffer still contains it.
    for (let i = 0; i < 20_000; i++) child.stderr.emit('data', FRAME_LINE)
    child.stderr.emit('data', REAL_SUMMARY)
    child.emit('close', 0)

    await expect(promise).resolves.toEqual({ integratedLufs: -17.2, truePeakDbtp: -0.1 })
  })
})

describe('finding ffmpeg', () => {
  beforeEach(() => {
    resetFfmpegAvailability()
  })

  it('prefers an explicitly configured binary, so a packaged build can point at a bundled one', () => {
    const bundled = '/Applications/AetherStar.app/Contents/Resources/ffmpeg'
    expect(ffmpegCandidates({ AETHERSTAR_FFMPEG: bundled })[0]).toBe(bundled)
  })

  it('looks past PATH at the places a Homebrew install actually lives', () => {
    // A macOS app launched from Finder inherits PATH=/usr/bin:/bin:/usr/sbin:/sbin,
    // so a bare `ffmpeg` misses the Homebrew install the user can run in their
    // own terminal. Naming these is the difference between the feature working
    // and silently doing nothing on most Macs.
    const candidates = ffmpegCandidates({}, 'darwin')
    expect(candidates[0]).toBe('ffmpeg')
    expect(candidates).toContain('/opt/homebrew/bin/ffmpeg')
    expect(candidates).toContain('/usr/local/bin/ffmpeg')
  })

  it('looks past PATH at the places Windows package managers install to', () => {
    const candidates = ffmpegCandidates({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', USERPROFILE: 'C:\\Users\\me' }, 'win32')
    expect(candidates[0]).toBe('ffmpeg')
    expect(candidates).toContain('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe')
    expect(candidates).toContain('C:\\Users\\me\\scoop\\shims\\ffmpeg.exe')
    expect(candidates).toContain('C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe')
    expect(candidates).not.toContain('/opt/homebrew/bin/ffmpeg')
    expect(ffmpegCandidates({ AETHERSTAR_FFMPEG: 'D:\\ff.exe' }, 'win32')[0]).toBe('D:\\ff.exe')
  })

  it('takes the first candidate that answers, and remembers it', async () => {
    const tried = []
    const spawn = (command) => {
      tried.push(command)
      const child = fakeChild()
      queueMicrotask(() => child.emit('close', command === '/opt/homebrew/bin/ffmpeg' ? 0 : 1))
      return child
    }

    await expect(resolveFfmpeg({ spawn, candidates: ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg'] })).resolves.toBe(
      '/opt/homebrew/bin/ffmpeg',
    )
    expect(tried).toEqual(['ffmpeg', '/opt/homebrew/bin/ffmpeg'])

    // Cached: a second ask does not re-probe, so a 1000-song backfill searches once.
    tried.length = 0
    await resolveFfmpeg({ spawn, candidates: ['ffmpeg'] })
    expect(tried).toEqual([])
  })

  it('resolves to nothing when there is no ffmpeg anywhere, rather than throwing', async () => {
    const spawn = () => {
      const child = fakeChild()
      queueMicrotask(() => child.emit('error', new Error('ENOENT')))
      return child
    }

    await expect(resolveFfmpeg({ spawn, candidates: ['ffmpeg', '/usr/bin/ffmpeg'] })).resolves.toBeNull()
  })
})
