import { useMemo } from 'react'
import { ClockLyrics } from '../stage/lyrics/ClockLyrics'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { useDesignScale } from '../scenes/designUnits'
import { AudienceSurface } from './AudienceSurface'
import { micRimColor } from '../design/tokens'
import { useT } from '../i18n'
import { clampCalibrationOffsetMs } from '../calibration/offsets'
import type { PlayerScore } from '../contracts/types'
import { AudienceNoteLanes } from './AudienceNoteLanes'
import { AudienceStageVideo } from './AudienceStageVideo'
import { buildAudienceLanes } from './audienceLanes'
import { useAudienceStageClock } from './useAudienceStageClock'
import { useAudienceNoteClears } from './useAudienceNoteClears'
import type { AudienceLyricState, AudiencePlayback, AudienceNoteClear, AudienceSinger, AudienceSingerPitch, AudienceSong } from './types'
import type { SessionMode } from '../session/types'
import { TugOfWarBar } from '../session/duel/TugOfWarBar'
import { AudienceLiveLeaderboard } from './AudienceLiveLeaderboard'

/**
 * The song, as the room sees it -- the audience half of the host's singer view.
 *
 * Drawn with the host's own components from the host's own chart, loaded
 * locally; only small, slow-moving state crosses IPC: the lyric cursor, a clock
 * *anchor* this window extrapolates (./useAudienceStageClock.ts), each singer's
 * pitch target (./pitchMirror.ts) and a bounded tail of judged notes replayed
 * into this window's hit store (./useAudienceNoteClears.ts).
 *
 * No sound at all: the video is muted and there is no `<audio>` element here.
 */
export function AudienceSingerView({
  song,
  mode,
  singers,
  players,
  lyrics,
  playback,
  clears,
  pitches,
  micRigConfigured,
}: {
  song: AudienceSong | null
  mode?: SessionMode
  singers: AudienceSinger[]
  players: PlayerScore[]
  lyrics: AudienceLyricState | null
  playback: AudiencePlayback | null
  clears: AudienceNoteClear[]
  /** Each singer's live pitch target, in semitones -- see ./pitchMirror.ts. */
  pitches: AudienceSingerPitch[]
  /** Whether any mic is set up on the host. With none, the host draws a single fallback lane and so must the television. */
  micRigConfigured: boolean
}) {
  const t = useT()
  const { chart, sourceDir } = useChartLoader(song?.path ?? null)
  const pausedByHost = playback?.pausedByHost === true
  // A restart on the host starts the note trail over here too.
  const epoch = playback?.epoch ?? 0

  // The host judges and draws against #GAP + its speaker-delay offset
  // (Sing.tsx), so the lanes and lyrics here run on the same shifted gap. The
  // backdrop video below keeps the raw chart meta and raw position, exactly as
  // the host's video does.
  const gapOffsetMs = clampCalibrationOffsetMs(playback?.gapOffsetMs ?? 0)
  const rawMeta = chart?.meta ?? null
  const meta = useMemo(
    () => (rawMeta && gapOffsetMs !== 0 ? { ...rawMeta, gap: rawMeta.gap + gapOffsetMs } : rawMeta),
    [rawMeta, gapOffsetMs],
  )
  const clock = useAudienceStageClock(playback, meta)
  // Keyed on the *loaded* chart (and the host's restarts): judgements that
  // landed before the lanes existed are replayed onto them. See useAudienceNoteClears.
  useAudienceNoteClears(clears, chart && song ? `${song.path}#${epoch}` : null)

  // Rebuilt only when the chart or the line-up changes, never per payload.
  const singersKey = useMemo(
    () => singers.map((s) => `${s.playerId}:${s.micNumber}:${s.name}`).join("|"),
    [singers],
  )
  const lanes = useMemo(
    () => (chart ? buildAudienceLanes(chart.lines, singers, micRigConfigured) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart, singersKey, micRigConfigured],
  )
  const laneColors = useMemo(() => lanes.map((lane) => lane.accentColor), [lanes])

  // A television across a room: the lyric box scales up with the design unit
  // (1 at 1080p, 2 at 4K), never down.
  const lyricScale = Math.max(1, useDesignScale())

  const videoMeta = useMemo(() => {
    if (!chart) return null
    if (chart.meta.videoPath) return chart.meta
    if (song?.videoPath) {
      return { ...chart.meta, videoPath: song.videoPath }
    }
    return chart.meta
  }, [chart, song?.videoPath])

  return (
    <AudienceSurface testId="audience-singer-view">
      {/* The song's video, behind everything, once the chart has resolved the
          directory #VIDEO is relative to. */}
      {videoMeta && sourceDir && <AudienceStageVideo meta={videoMeta} sourceDir={sourceDir} playback={playback} />}

      <div className="relative flex h-full w-full flex-col gap-[2.5vh] px-[4vw] py-[3.5vh]">
        {/* What is being sung, kept small: the lyrics are the screen. */}
        {song && (
          <header className="flex shrink-0 items-center gap-5">
            <div className="size-[7vmin] shrink-0 overflow-hidden rounded-[14%] border border-white/15 bg-white/10">
              {song.coverUrl && <img data-testid="audience-cover-image" src={song.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="flex min-w-0 flex-col">
              <span
                data-testid="audience-song-title"
                className="truncate text-[clamp(1.1rem,2.2vw,2.5rem)] font-bold text-[var(--ae-text-primary)]"
                // The halo keeps small type legible over a bright frame.
                style={{ textShadow: '0 2px 10px rgba(0,0,0,0.85)' }}
              >
                {song.title}
              </span>
              <span
                data-testid="audience-song-artist"
                className="truncate text-[clamp(0.8rem,1.3vw,1.5rem)] text-[var(--ae-text-secondary)]"
                style={{ textShadow: '0 2px 10px rgba(0,0,0,0.85)' }}
              >
                {song.artist}
              </span>
            </div>
          </header>
        )}

        {mode === 'battle' && singers.length >= 2 && singers[0].playerId && singers[1].playerId && (
          <div className="mx-auto w-full max-w-xl px-4 pb-2 shrink-0">
            <TugOfWarBar
              player1Id={singers[0].playerId}
              player2Id={singers[1].playerId}
              player1Color={micRimColor(singers[0].micNumber - 1)}
              player2Color={micRimColor(singers[1].micNumber - 1)}
              overrideScores={players}
              silent
            />
          </div>
        )}


        {/* The lanes take the middle band, between the header and the words. */}
        {chart && lanes.length > 0 ? (
          <AudienceNoteLanes
            key={epoch}
            lanes={lanes}
            pitches={pitches}
            bpm={chart.meta.bpm}
            beatPosition={clock.beatPosition}
          />
        ) : (
          <div className="min-h-0 flex-1" />
        )}

        <div className="flex shrink-0 items-center justify-center">
          {chart && lyrics ? (
            // The explicit width is load-bearing: at `auto` the w-full box would
            // collapse to min-content. 100/scale percent laid out is 100 percent
            // painted, since layout is measured before the transform.
            <div
              className="shrink-0"
              style={{
                width: `${100 / lyricScale}%`,
                transform: `scale(${lyricScale})`,
                transformOrigin: 'center',
              }}
            >
              <ClockLyrics lines={chart.lines} beatPosition={clock.beatPosition} partColors={laneColors} />
            </div>
          ) : (
            <p data-testid="audience-lyrics-pending" className="text-[clamp(1rem,2vw,2rem)] font-semibold text-[var(--ae-text-tertiary)]">
              {t('audience.sing.getReady')}
            </p>
          )}
        </div>

        {singers.length > 0 && <AudienceLiveLeaderboard singers={singers} players={players} />}
      </div>

      {/* The host paused the song: say so, rather than leave a frozen frame. */}
      {pausedByHost && (
        <div data-testid="audience-paused" className="absolute inset-0 flex items-center justify-center bg-black/55">
          <p className="rounded-[28px] bg-black/70 px-12 py-6 text-[clamp(2rem,5vw,5rem)] font-bold text-[var(--ae-text-primary)]">
            {t('audience.sing.paused')}
          </p>
        </div>
      )}
    </AudienceSurface>
  )
}
