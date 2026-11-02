import { clearSingerPitches, readSingerPitches } from '../../audience/pitchMirror'
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { Gameplay } from '../Gameplay'
import { noteHeightForLaneHeight } from '../lane/laneStack'
import { LANE_HEIGHT_PX } from '../lane/LanePanel'
import { PITCH_LINE_HEIGHT_PX } from '../lane/PitchLine'
import { computePitchRangeScaleFromPitches } from '../lane/pitchRangeScale'
import { usePitchStore } from '../../audio/pitchStore'
import { usePlayersStore } from '../../players/store'
import { useHitStore } from '../state/useHitStore'
import { useScoreStore } from '../state/useScoreStore'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../calibration/types'
import type { SongLine, SongMeta } from '../../contracts/types'

const META: SongMeta = { artist: 'Test', title: 'Song', mp3Path: 'song.mp3', bpm: 120, gap: 0, videoGap: 0 }
const LINES: SongLine[] = [{ part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 2, pitch: 9, syllable: 'la' }] }]

const A4_HZ = 440 // semitone 69, pitch class 9 -- exact match for the fixture note's pitch 9.

/**
 * A capture entry holding a 400 ms run of samples at `hz`, starting now. Notes
 * are paid per beat sung (see matching/noteCoverage.ts), so "sang this note"
 * has to be singing that lasts as long as the note does; samples beyond the
 * beats the clock buffer has observed are rejected by `beatAt` and cost nothing.
 */
function singing(hz: number, deviceId = 'dev-1') {
  const from = Date.now()
  return {
    latest: { t: from, hz, confidence: 1, deviceId },
    samples: Array.from({ length: 40 }, (_, i) => ({ t: from + i * 10, hz, confidence: 1, deviceId })),
    latencyMs: 0,
  }
}

describe('Gameplay', () => {
  beforeEach(() => {
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })
    useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
  })

  it('judges notes as playback crosses them, updates the real stores, and renders from that state', async () => {
    const beatPosition = motionValue(0)

    // Seed an active capture with on-pitch samples for the note's [0, 2) beat
    // span. A *run* of them at the detector's own cadence, not two 5ms apart:
    // a note is now scored on how much of its span was sung (see
    // matching/noteCoverage.ts), so "sang this note" has to be expressed as
    // singing that lasts as long as the note does. Samples beyond the beats the
    // clock buffer has observed are rejected by `beatAt` and cost nothing, so
    // over-seeding here is safe and keeps the test free of frame-timing races.
    const singingFrom = Date.now()
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t: singingFrom, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: Array.from({ length: 40 }, (_, i) => ({
            t: singingFrom + i * 10,
            hz: A4_HZ,
            confidence: 1,
            deviceId: 'dev-1',
          })),
          latencyMs: 0,
        },
      },
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)

    // Let the rAF loop record the clock buffer at beat 0/1 first, matching
    // the samples' t to a beat inside the note's span, before crossing past it.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3) // past the note's [0, 2) span -- triggers judging

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())

    const hit = useHitStore.getState().latest!
    expect(hit.noteId).toBe('note-0')
    expect(hit.tier).toBe('epic') // on-pitch samples -> epic judgment

    const scoreState = useScoreStore.getState()
    expect(scoreState.players.find((p) => p.playerId === 'p1')?.score).toBeGreaterThan(0)

    // Gameplay is now purely this player's layer of the *shared* note lane;
    // score/combo display moved out to the right-edge cards (ScoreColumn),
    // which read the very store asserted above. The lane and pitch line are
    // still Gameplay's own rendering.
    expect(screen.getByTestId('note-lane')).toBeInTheDocument()
    expect(screen.getByTestId('pitch-line')).toBeInTheDocument()
    // One note, sung perfectly: the whole 9,000 note pool plus the whole
    // 1,000 line bonus -- the fixed party-karaoke-style ceiling.
    await waitFor(() => expect(useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score).toBe(10_000))
    // ...and its line verdict, for the HUD to pop.
    expect(useScoreStore.getState().lineRatingByPlayerId.p1?.rating).toBe('perfect')
  })

  it('scores the assignedPlayerIds[0] player, not roster index 0, when provided', async () => {
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })
    const beatPosition = motionValue(0)

    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t: Date.now(), hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: [{ t: Date.now(), hz: A4_HZ, confidence: 1, deviceId: 'dev-1' }],
          latencyMs: 0,
        },
      },
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} assignedPlayerIds={['p2']} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    expect(useHitStore.getState().latest!.playerId).toBe('p2')
    expect(useScoreStore.getState().players[0]?.playerId).toBe('p2')
    // The rendered proof that p2's profile (not roster index 0's) is the one
    // in play: this layer's pitch line carries p2's accent colour. It used to
    // be p2's initial in a PlayerBadge, but the badge now lives on the
    // right-edge score card instead of inside the lane layer.
    expect(screen.getByTestId('pitch-line').style.background).toContain('gold')
  })

  it('falls back to roster index 0 when assignedPlayerIds is omitted (regression guard)', () => {
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })
    render(<Gameplay meta={META} lines={LINES} beatPosition={motionValue(0)} />)
    expect(useScoreStore.getState().players[0]?.playerId).toBe('p1')
    // Same substitution as above: roster index 0's accent colour on the lane
    // layer, in place of the PlayerBadge that moved to the score card.
    expect(screen.getByTestId('pitch-line').style.background).toContain('coral')
  })

  it('reads from an explicit deviceId prop instead of the first active capture, when given', async () => {
    const beatPosition = motionValue(0)
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': { latest: { t: Date.now(), hz: 1000, confidence: 1, deviceId: 'dev-1' }, samples: [], latencyMs: 0 },
        'dev-2': singing(A4_HZ, 'dev-2'),
      },
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} deviceId="dev-2" />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    // dev-2's on-pitch samples judge as epic; dev-1's wildly-off pitch would have judged awful.
    expect(useHitStore.getState().latest!.tier).toBe('epic')
  })

  it('does not reset the shared score/hit stores when seedStores={false} (multi-lane gameplay seeds once, up front)', async () => {
    useScoreStore.getState().reset({
      players: [
        { playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 500, combo: 3, rank: 2 },
      ],
      combo: 3,
      rank: ['p1', 'p2'],
    })
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })

    render(
      <Gameplay
        meta={META}
        lines={LINES}
        beatPosition={motionValue(0)}
        assignedPlayerIds={['p1']}
        seedStores={false}
      />,
    )

    // p2's pre-existing score survives -- a real reset() would have wiped it to a single-player array.
    expect(useScoreStore.getState().players.find((p) => p.playerId === 'p2')?.score).toBe(500)
  })

  it('applies calibrationStore settings: transposition undoes a flat singer, judging what would otherwise be awful as epic', async () => {
    useCalibrationStore.setState({
      settings: {
        outputOffsetMs: 0,
        inputDevices: { 'dev-1': { offsetMs: 0 } },
        players: { p1: { difficulty: 'normal', transpositionSemitones: 2 } },
      },
    })

    const beatPosition = motionValue(0)
    const flatHz = 440 * Math.pow(2, -2 / 12) // 2 semitones flat of A4 (the note's pitch class 9)

    usePitchStore.setState({ activeCaptures: { 'dev-1': singing(flatHz) } })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    // Without calibration, 2 semitones (200 cents) flat judges 'awful'; the saved
    // +2 semitone player transposition undoes it, landing back on pitch class 9.
    expect(useHitStore.getState().latest!.tier).toBe('epic')
  })

  it('applies calibrationStore difficulty: two semitones off misses at Normal but scores at Easy', async () => {
    useCalibrationStore.setState({
      settings: {
        outputOffsetMs: 0,
        inputDevices: { 'dev-1': { offsetMs: 0 } },
        players: { p1: { difficulty: 'easy', transpositionSemitones: 0 } },
      },
    })

    const beatPosition = motionValue(0)
    // Two semitones sharp: outside Normal's one-semitone tolerance, inside Easy's two.
    const sharpHz = 440 * Math.pow(2, 2 / 12)

    usePitchStore.setState({ activeCaptures: { 'dev-1': singing(sharpHz) } })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    expect(useHitStore.getState().latest!.tier).not.toBe('awful')
    expect(useHitStore.getState().latest!.credit).toBeGreaterThan(0)
  })

  it('never judges, scores or fires feedback for a freestyle note', async () => {
    const beatPosition = motionValue(0)
    usePitchStore.setState({ activeCaptures: { 'dev-1': singing(A4_HZ) } })
    const freestyle: SongLine[] = [{ part: 'solo', notes: [{ kind: 'freestyle', startBeat: 0, length: 2, pitch: 9, syllable: 'la' }] }]

    render(<Gameplay meta={META} lines={freestyle} beatPosition={beatPosition} />)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(useHitStore.getState().latest).toBeNull()
    expect(useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score).toBe(0)
  })

  it('sizes its notes for the lane it was given, so an eight-player stack is not all note and no track', () => {
    render(<Gameplay meta={META} lines={LINES} beatPosition={motionValue(0)} laneHeightPx={64} />)

    const block = screen.getByTestId('note-block')
    expect(block.style.height).toBe(`${noteHeightForLaneHeight(64)}px`)
    // Mapped onto the lane it actually has, not the 320px solo one: a note
    // positioned for a taller lane would simply be clipped away.
    expect(Number.parseFloat(block.style.top)).toBeLessThanOrEqual(64)
  })

  it('carries the mic slot colour when given one, instead of the player profile colour', () => {
    render(
      <Gameplay
        meta={META}
        lines={LINES}
        beatPosition={motionValue(0)}
        accentColor="rgb(0, 200, 120)"
      />,
    )

    // Identity follows the microphone now, not the person -- the lane has to
    // match the rim colour the player was handed on the assignment screen.
    expect(screen.getByTestId('pitch-line').style.background).toContain('rgb(0, 200, 120)')
  })

  it('gives its own singer a hit feedback layer, fired by the store this component writes to', async () => {
    const beatPosition = motionValue(0)
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t: Date.now(), hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: [
            { t: Date.now(), hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
            { t: Date.now() + 5, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          ],
          latencyMs: 0,
        },
      },
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
    expect(screen.getByTestId('lane-hit-fx')).toBeInTheDocument()

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    await waitFor(() =>
      expect(screen.getAllByTestId('hit-fx-slot').some((slot) => slot.dataset.firing === 'true')).toBe(true),
    )
    // The burst lands on the note that was judged, not in the middle of the lane.
    const fired = screen.getAllByTestId('hit-fx-slot').find((slot) => slot.dataset.firing === 'true')!
    expect(fired.style.top).not.toBe('')
  })
})

/**
 * # The magnetism is a *picture*, and never a judgement.
 *
 * The pitch indicator is now snapped onto the note it is near and glided
 * between positions (see lane/pitchSmoothing.ts). Both of those are lies, in
 * the sense that neither is what the detector reported -- and both are worth
 * telling, because a detector's output on a held human note wanders by tens of
 * cents and a line that will not sit still says "you are wobbling" while the
 * score says "that was excellent".
 *
 * What must never happen is the lie reaching `judgeNote`. Snapping the *scored*
 * value to the nearest chart note would award points for notes the singer never
 * hit -- the one bug a karaoke game cannot have. The tests below are the wall
 * between the two paths, asserted from opposite sides in the same render.
 */
describe('pitch magnetism is visual only', () => {
  const NOTE_HZ = A4_HZ // semitone 69, exactly the fixture note's pitch class
  // Two semitones sharp: outside Normal's snap window (1.5 semitones -- exactly
  // the raw pitches that round into the one-semitone tolerance) and outside
  // the tolerance itself. Drawn where it was sung, and scored as a miss.
  const SHARP_HZ = NOTE_HZ * Math.pow(2, 2 / 12)

  function seedCapture(hz: number) {
    usePitchStore.setState({ activeCaptures: { 'dev-1': singing(hz) } })
  }

  it('scores the raw pitch the singer actually sang, not the snapped one', async () => {
    const beatPosition = motionValue(0)
    // 40 cents sharp: drawn dead-centre on the note (see below), but the judge
    // must see the 40 cents, not the 0 the indicator shows.
    seedCapture(NOTE_HZ * Math.pow(2, 40 / 1200))

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    expect(useHitStore.getState().latest!.deviationCents).toBeCloseTo(40, 0)
  })

  it('scores nothing for a pitch outside the tolerance, however close the indicator draws it', async () => {
    const beatPosition = motionValue(0)
    seedCapture(SHARP_HZ)

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    const hit = useHitStore.getState().latest!
    expect(Math.abs(hit.deviationCents)).toBeGreaterThan(190)
    expect(hit.tier).toBe('awful')
    expect(useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score).toBe(0)
  })

  /**
   * A chart with an actual pitch *range*, unlike the single-note fixture above:
   * `computePitchRangeScale` collapses a zero-range chart to the lane's
   * midpoint for every pitch, which would make "on the note" and "four
   * semitones off it" land on exactly the same pixel and the assertions below
   * vacuous. The second note is parked far downstream so it is never judged
   * while the indicator is being measured.
   */
  const RANGE_LINES: SongLine[] = [
    {
      part: 'solo',
      notes: [
        { kind: 'normal', startBeat: 0, length: 2, pitch: 9, syllable: 'la' },
        { kind: 'normal', startBeat: 200, length: 2, pitch: 21, syllable: 'lo' },
      ],
    },
  ]
  const RANGE_SCALE = computePitchRangeScaleFromPitches([9, 21])
  const LANE_TRACK_PX = LANE_HEIGHT_PX - noteHeightForLaneHeight(LANE_HEIGHT_PX)

  /** Where the indicator should sit for a given octave-aligned semitone. */
  const drawnCentreFor = (semitone: number) =>
    RANGE_SCALE.toY(semitone, LANE_TRACK_PX) + noteHeightForLaneHeight(LANE_HEIGHT_PX) / 2 - PITCH_LINE_HEIGHT_PX / 2

  async function settleIndicator(beatPosition: ReturnType<typeof motionValue<number>>) {
    // Long enough for the frame-rate-independent glide to close on its target.
    for (let frame = 0; frame < 90; frame += 1) {
      beatPosition.set(1)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const transform = screen.getByTestId('pitch-line').style.transform
    return Number(/translateY\(([-\d.]+)px\)/.exec(transform)?.[1] ?? NaN)
  }

  it('still draws the indicator dead-centre on the note bar while it is scoring', async () => {
    const beatPosition = motionValue(0)
    // 40 cents sharp: wobbling inside the `good` band, so it scores.
    seedCapture(NOTE_HZ * Math.pow(2, 40 / 1200))

    render(<Gameplay meta={META} lines={RANGE_LINES} beatPosition={beatPosition} />)
    const drawnY = await settleIndicator(beatPosition)

    // Centred on note pitch 9 -- not on the ~9.4 that was actually sung.
    expect(drawnY).toBeCloseTo(drawnCentreFor(9), 0)
    expect(drawnY).not.toBeCloseTo(drawnCentreFor(9.4), 0)
  })

  /**
   * Two semitones off is outside Normal's tolerance, so the line must show it
   * where it was sung. Snapping it dead centre would draw a hit the judge
   * scores as a miss.
   */
  it('draws a note two semitones off where it was sung, not centred on the target', async () => {
    const beatPosition = motionValue(0)
    seedCapture(SHARP_HZ)

    render(<Gameplay meta={META} lines={RANGE_LINES} beatPosition={beatPosition} />)
    const drawnY = await settleIndicator(beatPosition)

    expect(drawnY).toBeCloseTo(drawnCentreFor(11), 0)
    expect(drawnY).not.toBeCloseTo(drawnCentreFor(9), 0)
  })

  /**
   * The other half of the wall: the snap must not reach across notes either.
   * A pitch that is genuinely on the wrong note has to be *drawn* on the wrong
   * note, or the indicator stops being a readout and becomes decoration.
   */
  it('leaves the indicator off the note when the singer is genuinely off it', async () => {
    const beatPosition = motionValue(0)
    // Four semitones sharp: far outside the snap window.
    seedCapture(A4_HZ * Math.pow(2, 4 / 12))

    render(<Gameplay meta={META} lines={RANGE_LINES} beatPosition={beatPosition} />)
    const drawnY = await settleIndicator(beatPosition)

    expect(drawnY).toBeCloseTo(drawnCentreFor(13), 0)
    expect(Math.abs(drawnY - drawnCentreFor(9))).toBeGreaterThan(1)
  })

  /**
   * No React state per frame. The indicator is a MotionValue written from the
   * rAF loop, and adding smoothing must not have quietly turned that into a
   * `useState` -- at 120Hz on eight lanes that is a thousand renders a second
   * of the most crowded subtree in the app.
   */
  it('glides without re-rendering: the position is a transform written outside React', async () => {
    const beatPosition = motionValue(0)
    seedCapture(NOTE_HZ)

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
    const line = screen.getByTestId('pitch-line')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const first = line.style.transform

    for (let frame = 0; frame < 20; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    // Same DOM node throughout (no remount), moved by transform, never `top`.
    expect(screen.getByTestId('pitch-line')).toBe(line)
    expect(line.style.top).toBe('0px')
    expect(line.style.transform).not.toBe('')
    expect(first).not.toBe('')
  })
})

/**
 * The sustained golden starburst: the reference frame's feedback for the note
 * you are landing *right now*, fired where the playhead crosses it.
 */
describe('the sustained starburst', () => {
  beforeEach(() => {
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
  })

  it('lights up where the playhead crosses a note the singer is landing', async () => {
    const beatPosition = motionValue(0)
    const t = Date.now()
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: [{ t, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' }],
          latencyMs: 0,
        },
      },
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
    beatPosition.set(1) // inside the note's [0, 2) span
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const spark = screen.getByTestId('lane-sustain-fx')
    expect(spark.dataset.on).toBe('true')
    // Positioned by transform, like everything else that moves inside a lane:
    // `top` here would invalidate layout for every note pill mounted beside it.
    expect(spark.style.transform).toMatch(/translate3d/)
  })

  /**
   * Fired on the *raw* judgement. A note two semitones off is outside Normal's
   * tolerance, so it must neither light the spark nor be drawn as if it were
   * on the note.
   */
  it('stays dark for a note two semitones off, and draws it where it was sung', async () => {
    clearSingerPitches()
    const beatPosition = motionValue(0)
    const t = Date.now()
    const sharp = A4_HZ * Math.pow(2, 2 / 12)
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t, hz: sharp, confidence: 1, deviceId: 'dev-1' },
          samples: [{ t, hz: sharp, confidence: 1, deviceId: 'dev-1' }],
          latencyMs: 0,
        },
      },
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(screen.getByTestId('lane-sustain-fx').dataset.on).toBe('false')
    expect(readSingerPitches()[0]?.semitone).toBeCloseTo(11, 5)
  })

  /**
   * The line and the score must agree. The snap window is exactly the raw
   * pitches that round into the judge's semitone tolerance (one semitone at
   * Normal, so +/-150 cents), so a note that is scoring is drawn centred on the
   * note and a note that is not scoring is not.
   */
  describe.each([
    ['inside the scoring band', 140, 9, 'on'],
    ['just outside the scoring band', 160, 10.6, 'off'],
  ] as const)('the pitch line %s', (_label, centsSharp, expectedSemitone, sparkState) => {
    it(`is drawn at ${expectedSemitone} and the spark is ${sparkState}`, async () => {
      clearSingerPitches()
      const beatPosition = motionValue(0)
      const t = Date.now()
      const hz = A4_HZ * Math.pow(2, centsSharp / 1200)
      usePitchStore.setState({
        activeCaptures: {
          'dev-1': {
            latest: { t, hz, confidence: 1, deviceId: 'dev-1' },
            samples: [{ t, hz, confidence: 1, deviceId: 'dev-1' }],
            latencyMs: 0,
          },
        },
      })

      render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
      beatPosition.set(1)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))

      expect(readSingerPitches()[0]?.semitone).toBeCloseTo(expectedSemitone, 5)
      expect(screen.getByTestId('lane-sustain-fx').dataset.on).toBe(sparkState === 'on' ? 'true' : 'false')
    })
  })

  it('is dark when nobody is singing at all', async () => {
    const beatPosition = motionValue(0)
    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(screen.getByTestId('lane-sustain-fx').dataset.on).toBe('false')
  })
})

/**
 * A lane's identity is the id it was handed, not whoever happens to be first in
 * the roster.
 *
 * `MultiplayerGameplay` names a lane `players[index]?.id ?? \`mic-${n}\``, so a
 * rig with more configured microphones than saved players hands out ids that
 * are deliberately not in the roster. Gameplay resolved its own id by looking
 * that id up and falling back to `players[0]` when it missed -- so with five
 * mics and two roster players, lanes 3, 4 and 5 all recorded their hits
 * against player 1: three singers' notes piling into one card while their own
 * stayed at zero. On the no-roster path every lane collapsed onto
 * LOCAL_PLAYER_ID_FALLBACK while the score store held `mic-1`..`mic-5`, so
 * nothing appeared to score at all.
 */
describe('Gameplay lane identity', () => {
  it('keeps the id it was given even when no roster profile matches it', async () => {
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })

    render(<Gameplay meta={META} lines={LINES} beatPosition={motionValue(0)} assignedPlayerIds={['mic-3']} />)

    await waitFor(() => expect(screen.getByTestId('gameplay').dataset.playerId).toBe('mic-3'))
  })

  it('does not attribute an unmatched lane to the first roster player', async () => {
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })

    render(<Gameplay meta={META} lines={LINES} beatPosition={motionValue(0)} assignedPlayerIds={['mic-5']} />)

    await waitFor(() => expect(screen.getByTestId('gameplay').dataset.playerId).not.toBe('p1'))
  })

  // The single-player call sites pass no ids at all; that path must be untouched.
  it('still falls back to the first roster player when given no id', async () => {
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })

    render(<Gameplay meta={META} lines={LINES} beatPosition={motionValue(0)} />)

    await waitFor(() => expect(screen.getByTestId('gameplay').dataset.playerId).toBe('p1'))
  })

  it('does not re-judge past notes or inflate score when re-rendered or resized mid-song', async () => {
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
    useScoreStore.getState().reset({
      players: [{ playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 }],
      combo: 0,
      rank: ['p1'],
    })

    const beatPosition = motionValue(0)
    const singingFrom = Date.now()
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t: singingFrom, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: Array.from({ length: 40 }, (_, i) => ({
            t: singingFrom + i * 10,
            hz: A4_HZ,
            confidence: 1,
            deviceId: 'dev-1',
          })),
          latencyMs: 0,
        },
      },
    })

    const { rerender } = render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} seedStores={false} />)

    // Advance clock past the first note [0, 2)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)
    await waitFor(() => expect(useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score).toBe(10_000))

    const scoreAfterFirstJudgement = useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score ?? 0
    expect(scoreAfterFirstJudgement).toBe(10_000)

    // Simulate multiple window resize events by re-rendering with new array references
    for (let i = 0; i < 5; i++) {
      rerender(<Gameplay meta={META} lines={[{ ...LINES[0], notes: [...LINES[0].notes] }]} beatPosition={beatPosition} seedStores={false} />)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    // Score must remain strictly identical (the 10,000 ceiling), never more
    const finalScore = useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score ?? 0
    expect(finalScore).toBe(10_000)
  })
})
