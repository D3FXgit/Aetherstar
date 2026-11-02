import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { glassSurfaceClass } from '../tokens'
import { PRESS_CLASS } from '../motion'
import { useSfx } from '../../audio/useSfx'
import type { SfxName } from '../../audio/sfxContract'

/**
 * `solid` is the default menu button; `primary` is the one filled call to
 * action on a screen; `danger` confirms something destructive; `glass` is only
 * for a button floating over video.
 */
export type ButtonVariant = 'solid' | 'primary' | 'danger' | 'glass'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  solid: 'bg-surface-raised border border-line hover:bg-surface-hover',
  primary: 'bg-[#f2f2f4] border border-transparent text-[#0a0a0c] hover:bg-white',
  danger: 'bg-accent-coral border border-transparent text-[#0a0a0c] hover:brightness-110',
  glass: `${glassSurfaceClass()} hover:bg-white/[0.14]`,
}

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Which one-shot plays on click: `'confirm'` for a commit, `'back'` for a retreat; defaults to the plain tick. */
  sfx?: SfxName
  variant?: ButtonVariant
}

// forwardRef so a dialog can move focus onto its own Cancel button.
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { children, className, sfx = 'click', variant = 'solid', onClick, onMouseEnter, ...rest },
  ref,
) {
  const playSfx = useSfx((state) => state.play)
  const classes = [
    VARIANT_CLASS[variant],
    'rounded-full px-6 py-3',
    PRESS_CLASS,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Sounds are wired here so every button is audible by default.
  return (
    <button
      ref={ref}
      data-variant={variant}
      className={classes}
      onClick={(event) => {
        playSfx(sfx)
        onClick?.(event)
      }}
      onMouseEnter={(event) => {
        playSfx('hover')
        onMouseEnter?.(event)
      }}
      {...rest}
    >
      {children}
    </button>
  )
})

/** The same component under its material-neutral name, for new code. */
export const Button = GlassButton
