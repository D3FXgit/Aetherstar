import { NeonText } from '../../design/primitives/NeonText'
import type { StageStatus } from '../stageStore'

interface CountdownProps {
  status: StageStatus
  /** The number to show (3, 2, 1). Null shows nothing. */
  seconds: number | null
}

/**
 * The "3, 2, 1" before the first note: a solid chip (no blur over playing
 * video) with big numerals. The countdown is one of the few moments the accent
 * glow is for, so the numerals carry it -- the chip keeps them legible.
 */
export function Countdown({ status, seconds }: CountdownProps) {
  if (status !== 'countdown' || seconds === null) return null

  return (
    <div
      data-testid="stage-countdown"
      role="timer"
      aria-live="off"
      className="m-auto rounded-[28px] border border-white/15 bg-black/70 px-10 py-6 text-center"
    >
      <NeonText accent="cyan" glow className="text-7xl font-bold tabular-nums">
        {seconds}
      </NeonText>
    </div>
  )
}
