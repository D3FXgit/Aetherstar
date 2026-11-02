import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { motion, motionValue } from 'framer-motion'
import type { SongLine } from '../../contracts/types'
import { msPerBeat } from '../../stage/timing/beatMs'
import { INSTRUMENTAL_GAP_MS, RETURN_LEAD_MS } from '../instrumentalBreaks'
import { useInstrumentalFade } from '../useInstrumentalFade'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

const BPM = 120
const beatsFor = (ms: number) => ms / msPerBeat(BPM)

/** Two lines with a comfortable instrumental stretch between them. */
const GAP_BEATS = beatsFor(INSTRUMENTAL_GAP_MS) + 20
const LINES: SongLine[] = [
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 4, pitch: 60, syllable: 'a' }] },
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 4 + GAP_BEATS, length: 4, pitch: 60, syllable: 'b' }] },
]

const NO_GAP_LINES: SongLine[] = [
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 4, pitch: 60, syllable: 'a' }] },
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 8, length: 4, pitch: 60, syllable: 'b' }] },
]

function Harness({ lines, beat }: { lines: SongLine[]; beat: ReturnType<typeof motionValue<number>> }) {
  const opacity = useInstrumentalFade(lines, BPM, beat)
  return <motion.div data-testid="pitch-container" style={{ opacity }} />
}

/**
 * Runs the rAF loop enough times for the fade animation to have fully landed.
 *
 * `frames` is a knob rather than a constant because a jsdom frame is a real
 * ~16ms timer: a test that steps the clock four times over the default 90
 * frames spends nearly six seconds in the loop and trips vitest's own timeout,
 * which then wrecks the act() environment for every test after it. A case that
 * only has to show *nothing happened* needs a handful of frames, not a whole
 * fade's worth.
 */
async function advance(beat: ReturnType<typeof motionValue<number>>, toBeat: number, frames = 90) {
  await act(async () => {
    beat.set(toBeat)
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  })
}

function opacityNow(): number {
  return Number(screen.getByTestId('pitch-container').style.opacity)
}

/**
 * The cinematic instrumental break: when the chart says nobody sings for more
 * than five seconds, the interface gets out of the way of the video, and comes
 * back 2.5 seconds before it is needed again.
 */
describe('useInstrumentalFade', () => {
  it('leaves the interface at full strength while the song is being sung', async () => {
    mocks.reducedMotion = false
    const beat = motionValue(0)
    render(<Harness lines={LINES} beat={beat} />)

    await advance(beat, 2)
    expect(opacityNow()).toBe(1)
  })

  it('fades the interface out once the last note of a line has passed', async () => {
    mocks.reducedMotion = false
    const beat = motionValue(0)
    render(<Harness lines={LINES} beat={beat} />)

    await advance(beat, 4 + GAP_BEATS / 2)
    expect(opacityNow()).toBe(0)
  })

  it('brings it back before the next line, not when the line starts', async () => {
    mocks.reducedMotion = false
    const beat = motionValue(0)
    render(<Harness lines={LINES} beat={beat} />)

    await advance(beat, 4 + GAP_BEATS / 2)
    expect(opacityNow()).toBe(0)

    // A hair after the 2.5s lead point: already on its way back, with the whole
    // remaining lead to finish in.
    await advance(beat, 4 + GAP_BEATS - beatsFor(RETURN_LEAD_MS) + 0.5)
    expect(opacityNow()).toBe(1)
  })

  it('never fades at all in a song with no instrumental stretch in it', async () => {
    mocks.reducedMotion = false
    const beat = motionValue(0)
    render(<Harness lines={NO_GAP_LINES} beat={beat} />)

    // A fade that was going to start would have started within a few frames;
    // there is no dissolve to sit out here, because nothing ever begins one.
    for (const at of [2, 6, 10, 40]) {
      await advance(beat, at, 10)
      expect(opacityNow()).toBe(1)
    }
  })

  /**
   * Reduce Motion removes the *fade*, not the behaviour. Leaving the interface
   * up would block the video for exactly the people who asked for less on
   * screen; the change simply becomes a cut instead of a dissolve.
   */
  it('still hides and shows under reduced motion, as a cut rather than a fade', async () => {
    mocks.reducedMotion = true
    const beat = motionValue(0)
    render(<Harness lines={LINES} beat={beat} />)

    await act(async () => {
      beat.set(4 + GAP_BEATS / 2)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    // Already all the way gone after a couple of frames -- no dissolve to sit
    // through.
    expect(opacityNow()).toBe(0)

    await act(async () => {
      beat.set(4 + GAP_BEATS)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(opacityNow()).toBe(1)
  })

  /**
   * The reason this is a MotionValue and not `useState`: the check runs on
   * every animation frame, and a state update here would re-render the entire
   * singer view a hundred times a second.
   */
  it('drives opacity without ever re-rendering its host', async () => {
    mocks.reducedMotion = false
    let renders = 0
    const beat = motionValue(0)

    function Counting({ lines }: { lines: SongLine[] }) {
      renders += 1
      const opacity = useInstrumentalFade(lines, BPM, beat)
      return <motion.div data-testid="pitch-container" style={{ opacity }} />
    }

    render(<Counting lines={LINES} />)
    const rendersAtMount = renders

    await advance(beat, 4 + GAP_BEATS / 2)
    expect(opacityNow()).toBe(0)
    await advance(beat, 4 + GAP_BEATS)
    expect(opacityNow()).toBe(1)

    // Two full transitions, and not one render for either of them.
    expect(renders).toBe(rendersAtMount)
  })
})
