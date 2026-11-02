import { useCallback, useEffect, useMemo, useRef } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { useAnimationFrame, useMotionValue, type MotionValue } from 'framer-motion'
import type { PitchSample, SongLine, SongMeta } from '../contracts/types'
import type { JudgedHit, LineRatingEvent } from './types'
import { freshLatestPitch, getCaptureStream, usePitchStore } from '../audio/pitchStore'
import { usePlayersStore } from '../players/store'
import { tokens } from '../design/tokens'
import { flattenNotes } from './matching/flattenNotes'
import { judgeNote } from './matching/judgeNote'
import { matchPitch, snapWindowSemitones } from './matching/hzToPitchClass'
import { octaveAlign } from './matching/octaveAlign'
import { createClockBuffer } from './matching/reconcileClock'
import { computePitchRangeScaleFromPitches, type PitchRangeScale } from './lane/pitchRangeScale'
import { LANE_HEIGHT_PX, PLAYHEAD_OFFSET_PERCENT } from './lane/LanePanel'
import { noteHeightForLaneHeight } from './lane/laneStack'
import { lerpTowards, snapToTarget } from './lane/pitchSmoothing'
import { NoteLane, type LiveFillHandle } from './lane/NoteLane'
import { useLanePaging } from './lane/LanePagingContext'
import { PitchLine, PITCH_LINE_HEIGHT_PX, type PitchLineHandle } from './lane/PitchLine'
import { publishSingerPitch } from '../audience/pitchMirror'
import { LaneHitFx } from './effects/LaneHitFx'
import { LaneSustainFx, type SustainHandle } from './effects/LaneSustainFx'
import { registerNoteKinds } from './effects/noteKindRegistry'
import { useHitStore } from './state/useHitStore'
import { useScoreStore } from './state/useScoreStore'
import { micHealthMessage, useMicHealthStore } from './state/useMicHealthStore'
import { useCalibrationStore } from '../calibration/calibrationStore'
import { useStageStore } from '../stage/stageStore'
import { msPerBeat } from '../stage/timing/beatMs'
import { useT } from '../i18n'
import { applyCalibration } from '../calibration/applyCalibration'
import { toleranceSemitonesFor } from '../calibration/difficulty'
import { buildScoringPlan, isScoredKind } from './scoring/scoringPlan'
import { scoreNote } from './scoring/scoreNote'
import { createLineTracker, lineRatingLabel } from './scoring/lineRating'

export const LOCAL_PLAYER_ID_FALLBACK = 'local-player'

/** The live fill is rewritten only when it has grown by at least this much -- a few DOM writes per note, not one per frame. */
const LIVE_FILL_STEP = 0.02

/**
 * How long a running capture may go without delivering a single audio frame
 * before its singer is told the mic has gone quiet.
 *
 * Generously long on purpose: batches arrive every ~50 ms in normal operation,
 * so this only fires when the audio thread has genuinely stopped, never
 * because a singer paused between lines (level-only frames keep arriving
 * throughout silence -- see usePitchStore's `isPitched`).
 */
const NO_FRAMES_TIMEOUT_MS = 2500

interface GameplayProps {
  meta: SongMeta
  lines: SongLine[]
  /** The stage's own clock, handed through its `overlay` -- never a second, drifting one. */
  beatPosition: MotionValue<number>
  /** The player this lane scores for: only `assignedPlayerIds[0]`. Omitted, roster index 0. */
  assignedPlayerIds?: string[]
  /** Reads this device's capture instead of the first active one, so each lane reads its own mic. */
  deviceId?: string
  /** When false, this lane leaves resetting the score/hit stores to its parent, which seeds every singer once instead of each lane overwriting the others. */
  seedStores?: boolean
  /**
   * The pitch scale this layer draws with. On a paged lane it is the lane's
   * live scale (see LanePagingContext), whose `toY` follows the page that is
   * up, so the pitch rule and the sustain spark follow it too. Omitted, a
   * paged lane's live scale is used, else this instance auto-fits to its own
   * notes, as it always did.
   */
  pitchScale?: PitchRangeScale
  /**
   * The height of the lane box this layer is being drawn into. Every singer
   * now gets their own lane rather than sharing one, and a stack of eight has
   * to divide the same vertical space two would (see laneStack.ts) -- so the
   * pitch scale, the note thickness and the hit burst all size off this.
   * Omitted keeps the original full-height solo lane exactly.
   */
  laneHeightPx?: number
  /**
   * The mic slot's rim colour (see `micRimColor`). Identity follows the
   * *microphone*, not the person, so the lane has to match the rim the player
   * was handed on the assignment screen rather than a colour stored on their
   * profile. Omitted falls back to the profile colour, exactly as before.
   */
  accentColor?: string
}

/**
 * The capture-guarantee effect run that currently speaks for each player.
 *
 * A cancelled run resumes after its `await` -- possibly after a newer run (a
 * StrictMode remount) started the capture it would tear down. It may only stop
 * what nothing has claimed since, so ownership outlives the instance.
 */
const captureOwners = new Map<string, symbol>()

/**
 * Keep only the samples sung *after* `noteEndBeat` -- the next notes' evidence.
 * Samples the clock buffer can no longer place (older than its window) are
 * genuinely unusable and are dropped here rather than carried forward forever.
 */
function dropConsumed(samples: PitchSample[], clock: ReturnType<typeof createClockBuffer>, noteEndBeat: number): PitchSample[] {
  return samples.filter((sample) => {
    const sampleBeat = clock.beatAt(sample.t)
    return sampleBeat !== null && sampleBeat >= noteEndBeat
  })
}

/**
 * One singer's lane layer: pitch matching, judging, scoring and drawing, all
 * on the stage's clock. Scores are written to the stores the score cards read.
 */
export function Gameplay({
  meta,
  lines,
  beatPosition,
  assignedPlayerIds,
  deviceId: explicitDeviceId,
  seedStores = true,
  pitchScale,
  laneHeightPx = LANE_HEIGHT_PX,
  accentColor: slotColor,
}: GameplayProps) {
  const notes = useMemo(() => flattenNotes(lines), [lines])
  /**
   * This singer's scoring budget: 10,000 over exactly the lines this lane was
   * given (its duet part plus shared lines), so a perfect run of either part
   * reaches the same maximum. Same `flattenNotes` ids as `notes`.
   */
  const plan = useMemo(() => buildScoringPlan(lines), [lines])
  const hasRapNotes = useMemo(() => notes.some((note) => note.kind === 'rap' || note.kind === 'goldenRap'), [notes])
  const ownScale = useMemo(() => computePitchRangeScaleFromPitches(notes.map((note) => note.pitch)), [notes])
  /** The lane's line paging, when it pages (see linePaging.ts). Null in labs and standalone tests. */
  const paging = useLanePaging()
  const scale = pitchScale ?? paging?.liveScale ?? ownScale

  const noteHeightPx = noteHeightForLaneHeight(laneHeightPx)
  // The pitch range is mapped onto slightly less than the lane box so the
  // lowest note still fits inside it instead of starting on the bottom edge.
  const laneTrackPx = laneHeightPx - noteHeightPx

  const players = usePlayersStore((state) => state.players)
  const assignedId = assignedPlayerIds?.[0]
  const playerProfile = (assignedId ? players.find((p) => p.id === assignedId) : undefined) ?? players[0]

  /**
   * The id this lane scores under is the one it was *given*, even when no
   * roster profile matches (a lane can be `mic-4` on a rig with more mics than
   * players). Re-deriving it through the profile would pile those lanes onto
   * player 1; the profile is only for the display name and colour.
   */
  const playerId = assignedId ?? playerProfile?.id ?? LOCAL_PLAYER_ID_FALLBACK
  const accentColor = slotColor ?? playerProfile?.color ?? tokens.accent.cyan

  /**
   * Where a note of pitch `p` is drawn *through its middle*, which is where the
   * pitch indicator has to sit for the snap in pitchSmoothing.ts to mean what
   * it says. `scale.toY` gives a note's top edge; the pill's own half-height
   * puts you on its centre line, and the rule's own half-height puts the rule's
   * centre there rather than its top.
   */
  const centreY = useCallback(
    (semitone: number) => scale.toY(semitone, laneTrackPx) + noteHeightPx / 2 - PITCH_LINE_HEIGHT_PX / 2,
    [scale, laneTrackPx, noteHeightPx],
  )

  // A lane that goes away takes its television marker with it, rather than
  // leaving one frozen for the staleness window to clear. Per player, not a
  // wholesale clear: the other singers' lanes are still running.
  useEffect(() => {
    return () => publishSingerPitch(playerId, null)
  }, [playerId])

  const pitchLineY = useMotionValue(centreY(scale.min))
  /** Where the indicator is heading. Written each frame; the motion value glides toward it. */
  const pitchTargetRef = useRef(centreY(scale.min))
  const lastRafAtRef = useRef(0)
  const sustainRef = useRef<SustainHandle | null>(null)
  const pitchLineRef = useRef<PitchLineHandle | null>(null)
  const liveFillRef = useRef<LiveFillHandle | null>(null)
  /** The note under the playhead and how much of it has been sung within tolerance so far (visual only). */
  const liveNoteRef = useRef<{ noteId: string; covered: number; lastBeat: number; written: number } | null>(null)
  /** The last fresh pitch run through applyCalibration, so the transform runs once per detector sample rather than per frame. */
  const calibratedLatestRef = useRef<{ source: PitchSample | null; transposition: number; hz: number }>({
    source: null,
    transposition: 0,
    hz: 0,
  })
  /** Wraps the pitch rule so a stale pitch (singer silent) can hide it without a React render. */
  const pitchLineWrapRef = useRef<HTMLDivElement | null>(null)
  const pitchVisibleRef = useRef(true)
  const lineTrackerRef = useRef(createLineTracker(plan))
  const lineTrackerPlanRef = useRef(plan)
  /** Absolute read positions into the capture stream (pitched / voiced) and the last batch seen. */
  const consumedVoicedRef = useRef(0)
  const pendingVoicedRef = useRef<PitchSample[]>([])
  const lastStreamSeqRef = useRef(-1)

  const clockBufferRef = useRef(createClockBuffer())
  const noteIndexRef = useRef(0)
  const judgedNoteIdsRef = useRef<Set<string>>(new Set())
  const lastChartSignatureRef = useRef<string | null>(null)
  const pendingSamplesRef = useRef<PitchSample[]>([])
  const consumedCountRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const lastFrameMarkerRef = useRef(-1)
  /** The last frame the song was paused on; samples from before it never count. */
  const lastPausedAtRef = useRef(0)
  /**
   * Wall time the song has spent paused, in total. The clock buffer and the
   * scored samples run on *song-running* time (`wall - pausedTotal`), so a
   * note that spans a pause is measured over the time it was actually up --
   * not over the menu and the resume lead-in, which nobody can sing in.
   */
  const pausedTotalRef = useRef(0)
  /** `pausedTotalRef` before the most recent pause: the offset for timestamps from before it. */
  const pausedTotalBeforeRef = useRef(0)
  /** The last frame the song was running on (wall ms, beat), to measure a pause from. */
  const lastRunningFrameRef = useRef<{ now: number; beat: number } | null>(null)
  const wasPausedRef = useRef(false)

  // Re-render on a language switch, so the mic warning below follows it.
  useT()
  const micHealth = useMicHealthStore((state) => state.byPlayerId[playerId]?.status)
  const micHealthWarning = micHealth ? micHealthMessage(micHealth) : null

  /**
   * Guarantees a capture is running for the device this lane reads -- a song
   * can be entered with none (bindings restored from disk, a capture shed by a
   * disconnect). Stops only what it started itself; captures owned elsewhere
   * are left exactly as found.
   */
  useEffect(() => {
    let cancelled = false
    let startedKey: string | null = null
    const report = useMicHealthStore.getState().report
    const ownership = Symbol('gameplay-capture')
    captureOwners.set(playerId, ownership)

    void (async () => {
      const pitch = usePitchStore.getState()
      const alreadyRunning =
        explicitDeviceId === undefined
          ? Object.keys(pitch.activeCaptures)[0]
          : pitch.activeCaptures[explicitDeviceId]
            ? explicitDeviceId
            : undefined

      if (alreadyRunning !== undefined) {
        report(playerId, 'ok', alreadyRunning)
        return
      }

      report(playerId, 'starting', explicitDeviceId ?? null)

      let target = explicitDeviceId
      if (target === undefined) {
        if (pitch.devices.length === 0) {
          await pitch.refreshDevices().catch(() => {})
          if (cancelled) return
        }
        target = usePitchStore.getState().devices[0]?.id
      }

      if (!target) {
        report(playerId, 'no-device', null)
        return
      }

      try {
        await usePitchStore.getState().startCapture(target)
      } catch {
        if (!cancelled) report(playerId, 'no-capture', target)
        return
      }
      if (cancelled) {
        // This run's cleanup already ran, so it must not leak the capture it
        // just started -- but only if nothing has claimed the player since.
        // A newer run (a StrictMode remount, or re-entering a song) is now
        // responsible for this capture and its own cleanup will stop it;
        // stopping it here would kill the mic out from under the live song.
        if (captureOwners.get(playerId) === undefined) {
          void Promise.resolve(usePitchStore.getState().stopCapture(target)).catch(() => {})
        }
        return
      }
      startedKey = target
      report(playerId, 'ok', target)
    })()

    return () => {
      cancelled = true
      // Only relinquish ownership if a newer run has not already taken it --
      // React runs an effect's cleanup before the replacing effect, so this is
      // normally still us, but an out-of-order teardown must not orphan the
      // live run's claim.
      if (captureOwners.get(playerId) === ownership) captureOwners.delete(playerId)
      useMicHealthStore.getState().clear(playerId)
      if (startedKey !== null) {
        // Safe to issue unconditionally: usePitchStore serializes start/stop
        // per capture key, so a replacing run's start -- issued after this
        // stop -- is applied after it and wins, rather than racing it.
        void Promise.resolve(usePitchStore.getState().stopCapture(startedKey)).catch(() => {})
      }
    }
  }, [explicitDeviceId, playerId])

  const chartSignature = `${notes.length}:${notes[0]?.noteId ?? ''}:${notes[0]?.startBeat ?? ''}:${playerId}`

  useEffect(() => {
    const isNewChart = lastChartSignatureRef.current !== chartSignature
    lastChartSignatureRef.current = chartSignature

    const resetTracking = () => {
      judgedNoteIdsRef.current.clear()
      noteIndexRef.current = 0
      pendingSamplesRef.current = []
      pendingVoicedRef.current = []
      consumedCountRef.current = 0
      consumedVoicedRef.current = 0
      lastStreamSeqRef.current = -1
      lastFrameAtRef.current = 0
      lastFrameMarkerRef.current = -1
      liveNoteRef.current = null
      lineTrackerRef.current = createLineTracker(plan)
      lineTrackerPlanRef.current = plan
    }

    if (seedStores) {
      useScoreStore.getState().reset({
        players: [{ playerId, name: playerProfile?.name ?? 'Player 1', score: 0, combo: 0, rank: 1 }],
        combo: 0,
        rank: [playerId],
      })
      useHitStore.getState().reset()
      resetTracking()
    } else if (isNewChart) {
      // Re-initialize note tracking ONLY when song/chart actually changes, never on resize re-renders
      resetTracking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed once per chart/player, not on every render
  }, [chartSignature, playerId, seedStores])

  useAnimationFrame(() => {
    const beat = beatPosition.get()
    const now = Date.now()

    // The pause menu freezes the clock; nothing sung meanwhile may count, fill
    // a note or move the pitch arrow -- and the frozen frames are not recorded
    // either. Recording (now, frozenBeat) through a pause stretched every note
    // spanning it by the whole pause, so its beats were measured over time
    // nobody could sing in (see matching/noteCoverage.ts).
    const paused = useStageStore.getState().status === 'paused'
    if (paused) {
      lastPausedAtRef.current = now
      wasPausedRef.current = true
    } else {
      const before = lastRunningFrameRef.current
      if (wasPausedRef.current && before) {
        // Wall time since the last running frame, less the playback that
        // really happened in it (the song resumed somewhere in between).
        const beatMs = msPerBeat(meta.bpm)
        const playedMs = Number.isFinite(beatMs) && beatMs > 0 ? Math.max(0, beat - before.beat) * beatMs : 0
        pausedTotalBeforeRef.current = pausedTotalRef.current
        pausedTotalRef.current += Math.max(0, now - before.now - playedMs)
      }
      wasPausedRef.current = false
      lastRunningFrameRef.current = { now, beat }
      clockBufferRef.current.record(now - pausedTotalRef.current, beat)
    }
    const pausedTotal = pausedTotalRef.current
    const lastRunningAt = lastRunningFrameRef.current?.now
    /** A capture timestamp on the song-running timeline the clock buffer keeps. */
    const toSongTime = (t: number) => {
      // Mid-pause: the pause is not in `pausedTotal` yet, and nothing past the
      // last running frame has been played.
      if (paused) return lastRunningAt === undefined ? t - pausedTotal : Math.min(t, lastRunningAt) - pausedTotal
      if (t > lastPausedAtRef.current) return t - pausedTotal
      // From before the latest resume: its own (earlier) offset, never past the resume point.
      return Math.min(t - pausedTotalBeforeRef.current, lastPausedAtRef.current - pausedTotal)
    }

    /** Lane-local Y of the note the singer is landing right now, or null. */
    let sustainSpark: number | null = null
    /** Whether the fresh pitch counts on the note under the playhead right now (feeds the live fill). */
    let onNoteNow = false

    const { activeCaptures } = usePitchStore.getState()
    const deviceId = explicitDeviceId ?? Object.keys(activeCaptures)[0]
    const capture = deviceId ? activeCaptures[deviceId] : undefined

    /**
     * The live sample history. Normally the store's mutable per-capture stream
     * (see `getCaptureStream`): read in place, never copied, and only touched
     * when its batch counter moved. A zustand entry seeded by hand (tests,
     * labs) has no stream behind it -- recognisable because its `samples` is
     * not the stream's array -- and is read from the entry itself.
     */
    const stream = deviceId ? getCaptureStream(deviceId) : undefined
    const live = capture && stream && stream.samples === capture.samples ? stream : undefined
    const streamSamples = capture ? capture.samples : null
    const streamDropped = live ? live.dropped : (capture?.droppedSamples ?? 0)
    const voicedSamples = live ? live.voiced : streamSamples
    const voicedDropped = live ? live.voicedDropped : streamDropped
    // Null once the newest pitch is older than STALE_PITCH_MS (see
    // freshLatestPitch). A hand-seeded entry has no arrival time for
    // `latest`; it is treated as fresh.
    const latestPitch = live ? freshLatestPitch(live, now) : (capture?.latest ?? null)
    const pitchIsFresh = latestPitch !== null
    // Calibration: inputOffsetMs/transposition are a pure
    // sample-data transform applied at this one read site; difficulty only
    // ever affects the semitone tolerance passed to judgeNote below. Absent
    // settings for this device/player, both are no-ops.
    const calibration = useCalibrationStore.getState().settings
    const inputOffsetMs = deviceId ? (calibration.inputDevices[deviceId]?.offsetMs ?? 0) : 0
    const playerCalibration = calibration.players[playerId]
    const transpositionSemitones = playerCalibration?.transpositionSemitones ?? 0
    const toleranceSemitones = toleranceSemitonesFor(playerCalibration?.difficulty ?? 'normal')

    // Mic health (see useMicHealthStore): the difference between "this singer
    // is off pitch" and "this singer's microphone is not running" is invisible
    // in the score -- both are a column of zeroes -- so it has to be said out
    // loud. Reporting is idempotent, so this costs nothing per frame until the
    // status actually changes.
    const health = useMicHealthStore.getState()
    if (!capture) {
      // 'starting'/'no-device' are set by the capture-guarantee effect above
      // and must not be overwritten by this loop before it has finished.
      const current = health.byPlayerId[playerId]?.status
      if (current !== 'starting' && current !== 'no-device') {
        health.report(playerId, 'no-capture', deviceId ?? null)
      }
    } else {
      // Any change in the capture's total frame count -- pitched samples plus
      // the ones evicted to keep it bounded -- means audio is still arriving.
      // `levelAt` moves on *every* frame including unpitched ones, so a singer
      // resting between lines never looks like a dead mic.
      const marker = live ? live.seq : (capture.droppedSamples ?? 0) + capture.samples.length + (capture.levelAt ?? 0)
      if (marker !== lastFrameMarkerRef.current) {
        lastFrameMarkerRef.current = marker
        lastFrameAtRef.current = now
      } else if (lastFrameAtRef.current === 0) {
        lastFrameAtRef.current = now
      }

      health.report(
        playerId,
        now - lastFrameAtRef.current > NO_FRAMES_TIMEOUT_MS ? 'no-frames' : 'ok',
        deviceId ?? null,
      )
    }

    /**
     * How far into the past the audio pipeline has actually been heard.
     *
     * Audio reaches this thread in ~50 ms batches, and a note is judged on the
     * frame the clock crosses its end -- so the last few tens of milliseconds
     * of every note are normally still in flight when the verdict is taken.
     * Coverage (see matching/noteCoverage.ts) must not charge the singer for
     * that, or every note in the song loses the same slice of credit and it
     * looks exactly like a clipped release.
     *
     * `levelAt` is when the newest batch landed and `latencyMs` is how old its
     * newest *frame* was at that instant -- pitched or not, which is what makes
     * this a horizon on the audio rather than on the singing. Their difference
     * is that frame's own timestamp, in the same clock the samples carry, and
     * it is shifted by the input offset for the same reason the samples are.
     */
    let observedUntil: number | null = null
    if (live) {
      if (live.lastBatchAt && live.latencyMs !== null) observedUntil = live.lastBatchAt - live.latencyMs - inputOffsetMs
    } else if (capture && capture.levelAt && capture.latencyMs !== null && capture.latencyMs !== undefined) {
      observedUntil = capture.levelAt - capture.latencyMs - inputOffsetMs
    }
    // On the same song-running timeline as the clock buffer and the samples.
    if (observedUntil !== null) observedUntil = toSongTime(observedUntil)

    if (capture && streamSamples) {
      // Early-out: nothing new since last frame means nothing to append. A
      // hand-seeded entry has no batch counter, so it is always read (cheap:
      // the slice below is empty when nothing was added).
      if (!live || live.seq !== lastStreamSeqRef.current) {
        lastStreamSeqRef.current = live ? live.seq : -1
        // The read positions are absolute counts since the capture started;
        // the store evicts from the front, so rebase by what it has dropped.
        // Clamping at 0 covers a stall that let more be evicted than we read:
        // those samples are gone, and reading from the start is the recovery.
        const calibrationArgs = { inputOffsetMs, transpositionSemitones }
        const unreadFrom = Math.max(0, consumedCountRef.current - streamDropped)
        if (!paused && unreadFrom < streamSamples.length) {
          const fresh = applyCalibration(streamSamples.slice(unreadFrom), calibrationArgs)
          // A batch can land just after a pause with samples sung during it.
          // The rest move onto song-running time, where the clock buffer is.
          for (let i = 0; i < fresh.length; i += 1) {
            if (fresh[i].t > lastPausedAtRef.current) pendingSamplesRef.current.push(pausedTotal === 0 ? fresh[i] : { ...fresh[i], t: fresh[i].t - pausedTotal })
          }
        }
        consumedCountRef.current = streamDropped + streamSamples.length

        // Voiced frames (any pitch) only matter to rap notes; a chart without
        // any never pays for them.
        if (!paused && voicedSamples && hasRapNotes) {
          const unreadVoicedFrom = Math.max(0, consumedVoicedRef.current - voicedDropped)
          if (unreadVoicedFrom < voicedSamples.length) {
            const freshVoiced = applyCalibration(voicedSamples.slice(unreadVoicedFrom), calibrationArgs)
            for (let i = 0; i < freshVoiced.length; i += 1) {
              if (freshVoiced[i].t > lastPausedAtRef.current) {
                pendingVoicedRef.current.push(pausedTotal === 0 ? freshVoiced[i] : { ...freshVoiced[i], t: freshVoiced[i].t - pausedTotal })
              }
            }
          }
        }
        consumedVoicedRef.current = voicedDropped + (voicedSamples?.length ?? 0)
      }

      // A pitch older than STALE_PITCH_MS is not what the singer is doing now
      // (silence never overwrites `latest`): drawing it froze the indicator on
      // the last note sung and fired "on pitch" sparks during rests.
      if (!paused && latestPitch && pitchIsFresh && noteIndexRef.current < notes.length) {
        // The same calibration transform the scored samples get, run once per
        // new detector sample (only its Hz is used here).
        const calibrated = calibratedLatestRef.current
        if (calibrated.source !== latestPitch || calibrated.transposition !== transpositionSemitones) {
          calibrated.source = latestPitch
          calibrated.transposition = transpositionSemitones
          calibrated.hz = applyCalibration([latestPitch], { inputOffsetMs, transpositionSemitones })[0].hz
        }
        const calibratedHz = calibrated.hz
        const note = notes[noteIndexRef.current]

        // THE RAW VALUE. `octaveAlign` only chooses which octave to draw it in;
        // it changes no interval and no cents. Everything below is a *display*
        // transform of this number -- the copy that gets scored is
        // `pendingSamplesRef` above, which never sees any of it.
        const rawSemitone = octaveAlign(calibratedHz, note.pitch)

        // Magnetism, visual only: inside the snap window -- exactly the raw
        // pitches that round into the judge's semitone tolerance -- the
        // indicator is pulled dead-centre onto the note bar, so a note that is
        // *scoring* looks like it is scoring, and one that is not is drawn
        // where it really is. Only while the note is under the playhead, and
        // never for a rap note (any pitch scores there, so there is no "on").
        const pitched = note.kind === 'normal' || note.kind === 'golden'
        const noteIsLive = beat >= note.startBeat && beat < note.startBeat + note.length
        const displaySemitone =
          noteIsLive && pitched ? snapToTarget(rawSemitone, note.pitch, snapWindowSemitones(toleranceSemitones)) : rawSemitone
        pitchTargetRef.current = centreY(displaySemitone)
        // The same number the rule above is heading for, offered to the
        // television. A semitone, not this lane's pixel Y -- the audience
        // window's lanes are a different height and map it through their own
        // geometry (see src/audience/pitchMirror.ts). A map write, so the
        // frame loop stays off React's render path exactly as before.
        publishSingerPitch(playerId, displaySemitone)

        // The sustained golden starburst fires on the *raw* judgement, never
        // the snapped value: snapping only ever moves the drawn line, so the
        // spark must be decided by what was actually sung.
        const inTolerance = pitched && matchPitch(calibratedHz, note.pitch, toleranceSemitones).tier !== 'awful'
        if (noteIsLive && inTolerance) {
          sustainSpark = scale.toY(note.pitch, laneTrackPx) + noteHeightPx / 2
        }
        // The live fill counts what the judge would: on a pitched note, a
        // pitch within the singer's semitone tolerance; on a rap note, any
        // voice at all. Freestyle is unscored and never fills.
        const rap = note.kind === 'rap' || note.kind === 'goldenRap'
        onNoteNow = noteIsLive && (inTolerance || rap)
      } else if (paused || !pitchIsFresh) {
        publishSingerPitch(playerId, null)
      }
    }

    // Hide the rule while there is no current pitch, rather than freezing it
    // on the last note sung. One style write per change, not per frame.
    const pitchVisible = Boolean(capture) && pitchIsFresh && !paused
    if (pitchVisible !== pitchVisibleRef.current && pitchLineWrapRef.current) {
      pitchVisibleRef.current = pitchVisible
      pitchLineWrapRef.current.style.opacity = pitchVisible ? '1' : '0'
    }

    // One glide per frame toward whatever the target ended up being. Frame-rate
    // independent (see pitchSmoothing.lerpTowards), so this behaves identically
    // on a 60Hz television and the 120Hz panel it is developed on, and a
    // dropped frame moves exactly as far as the two frames it replaced.
    const frameMs = lastRafAtRef.current === 0 ? 0 : now - lastRafAtRef.current
    lastRafAtRef.current = now
    if (frameMs > 0) pitchLineY.set(lerpTowards(pitchLineY.get(), pitchTargetRef.current, frameMs))
    sustainRef.current?.set(sustainSpark)
    // The same verdict the starburst fires on, told to the rule itself: the
    // line hardens while the singer is landing the note under the playhead.
    // Both setters skip an unchanged value, so this is a few DOM writes per
    // note rather than one per frame.
    pitchLineRef.current?.setOnPitch(sustainSpark !== null)

    // The live fill: the note under the playhead fills as it is sung, before
    // it is judged. Coverage is accumulated in beats from this frame's clock
    // advance while the singer is on it. Visual only -- the score is still
    // decided by judgeNote from the sample stream.
    const liveNote = notes[noteIndexRef.current]
    if (!paused && liveNote && liveNote.kind !== 'freestyle' && beat >= liveNote.startBeat && liveNote.length > 0) {
      let tracker = liveNoteRef.current
      if (!tracker || tracker.noteId !== liveNote.noteId) {
        tracker = { noteId: liveNote.noteId, covered: 0, lastBeat: liveNote.startBeat, written: 0 }
        liveNoteRef.current = tracker
      }
      const noteEnd = liveNote.startBeat + liveNote.length
      const advanced = Math.max(0, Math.min(beat, noteEnd) - Math.max(tracker.lastBeat, liveNote.startBeat))
      tracker.lastBeat = Math.max(tracker.lastBeat, Math.min(beat, noteEnd))
      if (onNoteNow) tracker.covered += advanced
      const fraction = Math.min(1, tracker.covered / liveNote.length)
      if (fraction - tracker.written >= LIVE_FILL_STEP || (fraction >= 1 && tracker.written < 1)) {
        tracker.written = fraction
        liveFillRef.current?.set(liveNote.noteId, fraction)
      }
    }

    // Judged notes and completed lines are collected and committed together
    // at the end of the frame. Writing per note meant that clearing a backlog
    // -- the clock starting ahead of the chart, or a stall dropping a run of
    // frames -- fired synchronous zustand notifications per note inside a
    // single animation frame, which React aborts with "Maximum update depth
    // exceeded" at a few hundred notes.
    const judgedThisFrame: { event: JudgedHit; note: (typeof notes)[number] }[] = []
    const linesThisFrame: LineRatingEvent[] = []
    // The plan the tracker was built from must be the one scoring this frame.
    if (lineTrackerPlanRef.current !== plan) {
      lineTrackerRef.current = createLineTracker(plan)
      lineTrackerPlanRef.current = plan
    }

    while (noteIndexRef.current < notes.length && beat >= notes[noteIndexRef.current].startBeat + notes[noteIndexRef.current].length) {
      const note = notes[noteIndexRef.current]
      if (judgedNoteIdsRef.current.has(note.noteId)) {
        noteIndexRef.current++
        continue
      }
      judgedNoteIdsRef.current.add(note.noteId)

      // Freestyle is unscored and gets no feedback: no judgement, no hit, no FX.
      if (isScoredKind(note.kind)) {
        const judgment = judgeNote(
          note,
          pendingSamplesRef.current,
          clockBufferRef.current,
          toleranceSemitones,
          observedUntil,
          pendingVoicedRef.current,
        )
        const points = scoreNote(note, judgment.credit, plan)
        // `credit` rides along on the event because the note lane turns it into
        // how far the pill fills; `points` is what the score store adds. One
        // judgement, one source.
        const hitEvent: JudgedHit = {
          playerId,
          tier: judgment.tier,
          noteId: note.noteId,
          deviationCents: judgment.deviationCents,
          t: now,
          credit: judgment.credit,
          points,
        }
        judgedThisFrame.push({ event: hitEvent, note })

        const completed = lineTrackerRef.current.record(note.noteId, points)
        if (completed) {
          linesThisFrame.push({
            playerId,
            lineIndex: completed.lineIndex,
            rating: completed.rating,
            label: lineRatingLabel(completed.rating),
            fraction: completed.fraction,
            bonusPoints: completed.bonusPoints,
            t: now,
          })
        }
      }

      // Keep whatever was sung *after* this note instead of dropping the whole
      // buffer. Clearing it outright threw away the next note's samples every
      // time two notes fell in one frame -- which is every dropped frame on a
      // legato passage, and cost about a third of the notes in a run with
      // realistic frame hitches. Samples the clock buffer can no longer place
      // (older than its window) are genuinely unusable and are dropped here
      // rather than carried forward forever.
      const noteEndBeat = note.startBeat + note.length
      pendingSamplesRef.current = dropConsumed(pendingSamplesRef.current, clockBufferRef.current, noteEndBeat)
      if (pendingVoicedRef.current.length > 0) {
        pendingVoicedRef.current = dropConsumed(pendingVoicedRef.current, clockBufferRef.current, noteEndBeat)
      }
      noteIndexRef.current++
    }

    if (judgedThisFrame.length > 0 || linesThisFrame.length > 0) {
      // Both stores in ONE React commit: the hit store drives the lane FX and
      // pill fills, the score store the cards and line pops.
      unstable_batchedUpdates(() => {
        if (judgedThisFrame.length > 0) useHitStore.getState().recordHits(judgedThisFrame.map((judged) => judged.event))
        useScoreStore.getState().applyHits(judgedThisFrame, linesThisFrame)
      })
    }
  })

  // Where a judged note sat in this lane, so its burst lands on the note
  // rather than in the middle of the lane. Memoised on the same inputs the
  // note positions themselves use, so the FX layer's store subscription is
  // never torn down by an unrelated re-render.
  // The burst layer is handed a note *id* and needs the note's *kind* to tell a
  // cleared golden note from an ordinary Excellent. It is a sibling of the note
  // lane with no view of the chart, so the chart publishes what it knows here,
  // for the life of the song. Ref-counted inside, so eight lanes sharing one
  // chart each register and release independently.
  useEffect(() => registerNoteKinds(notes), [notes])

  const noteById = useMemo(() => new Map(notes.map((note) => [note.noteId, note])), [notes])

  const resolveNoteY = useCallback(
    (noteId: string) => {
      const note = noteById.get(noteId)
      if (!note) return null
      // On a paged lane, the note's *own* page decides its Y: the page may
      // already have flipped by the time its last note is judged.
      const placement = paging?.notePlacement(noteId)
      const noteScale = placement?.scale ?? scale
      return noteScale.toY(note.pitch, laneTrackPx) + noteHeightPx / 2
    },
    [noteById, paging, scale, laneTrackPx, noteHeightPx],
  )

  /** On a paged lane, the burst lands where the note ended across the lane. */
  const resolveNoteX = useMemo(
    () => (paging ? (noteId: string) => paging.notePlacement(noteId)?.endPercent ?? null : undefined),
    [paging],
  )

  return (
    <div className="absolute inset-0" data-testid="gameplay" data-player-id={playerId}>
      <NoteLane
        notes={notes}
        beatPosition={beatPosition}
        laneHeightPx={laneHeightPx}
        trackHeightPx={laneTrackPx}
        noteHeightPx={noteHeightPx}
        scale={scale}
        accentColor={accentColor}
        contentOffsetPercent={PLAYHEAD_OFFSET_PERCENT}
        liveFillHandle={liveFillRef}
      />
      {/* The pitch rule spans from the field's left edge to the playhead and
          sizes itself from PLAYHEAD_OFFSET_PERCENT. */}
      <div
        ref={pitchLineWrapRef}
        data-testid="pitch-line-wrap"
        className="pointer-events-none absolute inset-0"
        style={{ transition: 'opacity 120ms linear' }}
      >
        <PitchLine y={pitchLineY} color={accentColor} handle={pitchLineRef} x={paging?.playheadX} />
      </div>
      {/* The golden starburst where the playhead crosses a note being landed.
          Driven straight from the frame loop above through an imperative
          handle -- a prop would be a React render per frame. */}
      <LaneSustainFx handle={sustainRef} color={accentColor} x={paging?.playheadX} />
      {/* This singer's own hit feedback. It subscribes to useHitStore
          imperatively, so a landing note never re-renders the lane above it. */}
      <LaneHitFx
        playerId={playerId}
        color={accentColor}
        laneHeightPx={laneHeightPx}
        resolveNoteY={resolveNoteY}
        resolveNoteX={resolveNoteX}
      />
      {/* A dead microphone looks exactly like a bad singer, so say so in the
          singer's own lane rather than hand them a silent zero. */}
      {micHealthWarning !== null && (
        <div
          data-testid="mic-health-warning"
          data-mic-health={micHealth}
          role="status"
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit max-w-full rounded-full border border-[#ff5d5d]/50 bg-[#2a0d0d]/90 px-4 py-1.5 text-center text-[0.78rem] font-medium text-[#ffb4b4]"
        >
          {micHealthWarning}
        </div>
      )}
    </div>
  )
}
