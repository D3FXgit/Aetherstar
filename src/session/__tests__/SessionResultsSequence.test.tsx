/**
 * One end-to-end pass over the results choreography on the real clock.
 *
 * Separate from SessionResults.test.tsx on purpose. framer-motion's frame loop
 * is a module singleton that closes over whatever `requestAnimationFrame` was
 * global when it was imported, so a fake clock can drive the beat timers but
 * never the roll itself -- and a file that has installed a fake clock leaves
 * that singleton in a state where the real one no longer steps it properly.
 * Everything about *gating and order* is proved deterministically over there;
 * this is the one test that lets the whole timeline actually run and checks that
 * the counter, its ticking and the sounds work together.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionResults } from '../SessionResults'
import { useSessionStore } from '../sessionStore'
import { usePlayersStore } from '../../players/store'
import { useSfx } from '../../audio/useSfx'
import { beatSchedule, countDurationMs, SCORE_TICK_MIN_INTERVAL_MS } from '../resultsChoreography'
import type { SfxName } from '../../audio/sfxContract'
import type { LibrarySong } from '../../library/types'
import type { SongChart } from '../../contracts/types'

const SONG: LibrarySong = {
  path: '/library/nova',
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: '/library/nova/song.mp3',
  videoPath: null,
  bpm: 250,
  gap: 24065,
  hasVideo: true,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

const CHART: SongChart = {
  meta: { artist: 'Nova Lane', title: 'Paper Satellites', mp3Path: 'song.mp3', bpm: 120, gap: 0, videoGap: 0 },
  lines: [{ part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 4, pitch: 60, syllable: 'Hello' }] }],
}

vi.mock('../../stage/chart/useChartLoader', () => ({
  useChartLoader: () => ({ status: 'ready', chart: CHART, sourceDir: '/library/nova', error: null }),
}))

const playSfx = vi.fn<(name: SfxName) => void>()
const WINNER_SCORE = 10000
const SEQUENCE_END_MS = beatSchedule(WINNER_SCORE).actions + 600

function sfxCount(name: SfxName): number {
  return playSfx.mock.calls.filter(([called]) => called === name).length
}

describe('SessionResults, whole sequence on the real clock', () => {
  beforeEach(() => {
    playSfx.mockClear()
    useSfx.setState({ play: playSfx })
    useSessionStore.setState({
      phase: 'results',
      sessionId: 's1',
      selectedSong: SONG,
      assignedPlayerIds: ['p1', 'p2'],
      lastResult: [
        { playerId: 'p1', score: 4200, epicCount: 0, goodCount: 1, awfulCount: 0, bestLine: 'Alex line' },
        { playerId: 'p2', score: WINNER_SCORE, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: 'Hello' },
      ],
      songsPlayedThisSession: 1,
    })
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '', songsSung: 2, bestScore: 30 },
        { id: 'p2', name: 'Mira', color: 'gold', avatarUrl: '', songsSung: 4, bestScore: 10 },
      ],
    })
    window.api = {
      session: { start: vi.fn(), recordEntry: vi.fn().mockResolvedValue(undefined), listLeaderboard: vi.fn() },
      players: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
        reorder: vi.fn(),
        readImportedPhoto: vi.fn(),
      },
    } as unknown as Window['api']
  })

  it(
    'rolls the score to the real total, ticking as it goes, and lands every cue in order',
    async () => {
      render(<SessionResults />)
      expect(screen.getByTestId('results-score')).toHaveTextContent('00000')

      await waitFor(() => expect(screen.getByRole('button', { name: /choose new song/i })).toBeInTheDocument(), {
        timeout: SEQUENCE_END_MS + 3000,
      })
      // The bong trails the bing by a beat of its own.
      await waitFor(() => expect(sfxCount('uiBong')).toBe(1), { timeout: 1000 })

      // Beat 5 actually counted, and landed exactly on the score.
      expect(screen.getByTestId('results-score')).toHaveTextContent('10000')

      const ticks = sfxCount('scoreTick')
      expect(ticks).toBeGreaterThan(2)
      // The whole point of the throttle: never once per animation frame. Ungated
      // at 60fps this roll would fire the 35ms sample ~84 times, overlapping
      // itself into a buzz.
      expect(ticks).toBeLessThanOrEqual(Math.ceil(countDurationMs(WINNER_SCORE) / SCORE_TICK_MIN_INTERVAL_MS) + 2)

      const names = playSfx.mock.calls.map(([name]) => name)
      expect(names.indexOf('crownLand')).toBeLessThan(names.indexOf('scoreTick'))
      expect(names.indexOf('scoreTick')).toBeLessThan(names.indexOf('uiBing'))
      expect(sfxCount('crownLand')).toBe(1)
      expect(sfxCount('cheer')).toBe(1)
      expect(sfxCount('uiBing')).toBe(1)

      // And the confetti has torn itself down rather than being left running on
      // a screen that stays open.
      await waitFor(() => expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument(), { timeout: 3000 })

      // The write-backs fired once each, across the whole sequence.
      expect(window.api!.session.recordEntry).toHaveBeenCalledTimes(2)
      expect(window.api!.players.update).toHaveBeenCalledTimes(2)
    },
    SEQUENCE_END_MS + 10000,
  )
})
