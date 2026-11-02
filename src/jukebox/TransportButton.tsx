// A round icon button for the controls that float over the jukebox's video.
// It sits *on* a glass surface, so it carries no blur of its own: a clear
// button that lights up on hover/focus, or the solid primary fill for Play.
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { PRESS_CLASS } from '../design/motion'
import { useSfx } from '../audio/useSfx'
import type { SfxName } from '../audio/sfxContract'

type Size = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<Size, string> = {
  sm: 'size-11 text-[1.25rem]',
  md: 'size-14 text-[1.6rem]',
  lg: 'size-[4.5rem] text-[2rem]',
}

interface TransportButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** The accessible name (and tooltip): these buttons show only a glyph. */
  label: string
  size?: Size
  /** The one filled control (Play/Pause). */
  primary?: boolean
  /** A toggle that is on (Shuffle, Repeat): drawn in the accent. */
  active?: boolean
  sfx?: SfxName
}

export const TransportButton = forwardRef<HTMLButtonElement, TransportButtonProps>(function TransportButton(
  { label, size = 'md', primary = false, active = false, sfx = 'click', className, onClick, children, ...rest },
  ref,
) {
  const playSfx = useSfx((state) => state.play)
  const look = primary
    ? 'bg-[#f2f2f4] text-[#0a0a0c] hover:bg-white'
    : active
      ? 'bg-white/[0.12] text-accent-cyan hover:bg-white/[0.18]'
      : 'text-ink-primary hover:bg-white/[0.12]'
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={['flex shrink-0 items-center justify-center rounded-full', SIZE_CLASS[size], look, PRESS_CLASS, className]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        playSfx(sfx)
        onClick?.(event)
      }}
      {...rest}
    >
      {children}
    </button>
  )
})
