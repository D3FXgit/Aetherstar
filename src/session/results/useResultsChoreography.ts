// The results celebration's timeline: which beat the screen is on, the sounds
// that land with each beat, skipping, and where focus goes.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SfxName } from '../../audio/sfxContract'
import { BEAT_DURATIONS, FINAL_BEAT, beatSchedule, isAtLeast, type ResultsBeat } from '../resultsChoreography'

interface ChoreographyOptions {
  hasResult: boolean
  /** The winner's score; the count beat's length depends on it. */
  score: number
  reduceMotion: boolean
  playSfx: (name: SfxName) => unknown
}

export interface ResultsChoreography {
  beat: ResultsBeat
  /** Skipped, or reduced motion: show final states without animating into them. */
  settled: boolean
  skipped: boolean
  /** The sequence is still playing and can be skipped. */
  canSkip: boolean
  skip: () => void
  /** Focus lands here while the sequence runs ... */
  skipRef: RefObject<HTMLButtonElement | null>
  /** ... and here once it is over, or when there was no sequence. */
  primaryRef: RefObject<HTMLButtonElement | null>
}

export function useResultsChoreography({ hasResult, score, reduceMotion, playSfx }: ChoreographyOptions): ResultsChoreography {
  const schedule = useMemo(() => beatSchedule(score), [score])

  // Reduced motion never enters the sequence: the finished state is the first frame.
  const [beat, setBeat] = useState<ResultsBeat>(reduceMotion ? FINAL_BEAT : 'winner')
  const [skipped, setSkipped] = useState(reduceMotion)

  const skipRef = useRef<HTMLButtonElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const heldFocusRef = useRef(false)

  const skip = useCallback(() => {
    setSkipped(true)
    setBeat(FINAL_BEAT)
  }, [])

  // Each beat's sound fires from the timer that advances to it, so skipping
  // (which clears every pending timer) silences the cues that had not happened yet.
  useEffect(() => {
    if (reduceMotion || skipped || !hasResult) return

    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, run: () => void) => timers.push(setTimeout(run, ms))

    at(schedule.crown, () => {
      setBeat('crown')
      // The impact and the room's reaction are one moment; the cheer then
      // plays as a bed under the rest of the sequence.
      playSfx('crownLand')
      playSfx('cheer')
    })
    at(schedule.slide, () => setBeat('slide'))
    at(schedule.roster, () => setBeat('roster'))
    at(schedule.count, () => setBeat('count'))
    at(schedule.actions, () => {
      setBeat('actions')
      playSfx('uiBing')
    })
    at(schedule.actions + BEAT_DURATIONS.actionsSecondToneDelayMs, () => playSfx('uiBong'))

    return () => timers.forEach(clearTimeout)
  }, [reduceMotion, skipped, hasResult, schedule, playSfx])

  // Reduced motion is about motion, not celebration: the cheer still plays,
  // the cues tied to movements that no longer happen do not.
  const cheeredRef = useRef(false)
  useEffect(() => {
    if (!reduceMotion || !hasResult || cheeredRef.current) return
    cheeredRef.current = true
    playSfx('cheer')
  }, [reduceMotion, hasResult, playSfx])

  // Any key or click skips -- except Escape/Backspace, which belong to the
  // global Back handler (swallowing them would make leaving take two presses).
  const sequenceRunning = !reduceMotion && !skipped && hasResult
  useEffect(() => {
    if (!sequenceRunning) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Backspace') return
      skip()
    }
    const handlePointerDown = () => skip()

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [sequenceRunning, skip])

  // A gamepad needs somewhere to point the moment the screen appears.
  useEffect(() => {
    if (!hasResult) return
    if (skipRef.current) {
      skipRef.current.focus()
      heldFocusRef.current = true
    } else {
      primaryRef.current?.focus()
    }
  }, [hasResult])

  // When Skip disappears it takes the focused element with it; hand focus to
  // the primary action, but only if nobody has moved it elsewhere meanwhile.
  useEffect(() => {
    if (!hasResult || !heldFocusRef.current || !isAtLeast(beat, FINAL_BEAT)) return
    heldFocusRef.current = false
    const active = document.activeElement
    if (!active || active === document.body) primaryRef.current?.focus()
  }, [hasResult, beat])

  return {
    beat,
    settled: reduceMotion || skipped,
    skipped,
    canSkip: sequenceRunning && !isAtLeast(beat, FINAL_BEAT),
    skip,
    skipRef,
    primaryRef,
  }
}
