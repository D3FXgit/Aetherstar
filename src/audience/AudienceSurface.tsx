import type { ReactNode } from 'react'
import { micColor, tokens } from '../design/tokens'
import { PlayerBadge } from '../players/PlayerBadge'
import type { AudienceSinger } from './types'

/**
 * The full-bleed field every audience screen is drawn on.
 *
 * Flat paint only, never `backdrop-filter`: this is a whole television, and a
 * live blur at that size costs device-pixel area x radius on every frame.
 */
export const AUDIENCE_BACKGROUND = tokens.palette.background

export function AudienceSurface({
  testId,
  children,
  className = '',
}: {
  testId: string
  children: ReactNode
  className?: string
}) {
  return (
    <div data-testid={testId} className={`fixed inset-0 overflow-hidden ${className}`} style={{ background: AUDIENCE_BACKGROUND }}>
      {children}
    </div>
  )
}

/**
 * The microphone number, drawn as a filled chip in that mic's colour.
 *
 * The number is the identifier and is always drawn; the colour only reinforces
 * it, so the room can tell singers apart without telling colours apart.
 */
export function MicChip({ micNumber, size = 44 }: { micNumber: number; size?: number }) {
  return (
    <span
      data-testid="audience-mic-chip"
      data-mic-number={micNumber}
      className="flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums text-black"
      style={{ height: size, width: size, fontSize: size * 0.5, background: micColor(micNumber) }}
    >
      {micNumber}
    </span>
  )
}

/**
 * One singer in a list: their badge in their mic's colour, the mic number, the
 * name, and whatever the screen wants to say about them on the trailing side.
 */
export function AudienceSingerRow({
  singer,
  trailing,
  badgeSize = 64,
  testId = 'audience-singer-row',
}: {
  singer: AudienceSinger
  trailing?: ReactNode
  badgeSize?: number
  testId?: string
}) {
  return (
    <li
      data-testid={testId}
      data-mic-number={singer.micNumber}
      className="flex items-center gap-6 rounded-3xl border border-line bg-surface-panel px-6 py-3"
    >
      <PlayerBadge name={singer.name} color={micColor(singer.micNumber)} avatarUrl={singer.avatarUrl} size={badgeSize} />
      <MicChip micNumber={singer.micNumber} size={Math.round(badgeSize * 0.62)} />
      <span className="flex-1 truncate text-[clamp(1.25rem,2.2vw,2.25rem)] font-bold text-ink-primary">{singer.name}</span>
      {trailing}
    </li>
  )
}
