import type { InputHTMLAttributes } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { tokens } from '../tokens'

type Accent = keyof typeof tokens.accent

interface GlassToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'checked'> {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name, set as `aria-label`: the visible label lives in the row beside the switch. */
  label: string
  accent?: Accent
}

// A 52x30 px hit target, well over the desktop minimum.
const TRACK_WIDTH = 52
const TRACK_HEIGHT = 30
const KNOB_SIZE = 22
const KNOB_INSET = 4
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2

/**
 * The app's switch: a solid track that fills with the accent when on. Under
 * the paint it is a real checkbox stretched over the track, so pointer, Space
 * and assistive tech all drive a native control.
 */
export function GlassToggle({ checked, onChange, label, accent = 'cyan', className, disabled, ...rest }: GlassToggleProps) {
  const reduceMotion = useReducedMotion()
  const color = tokens.accent[accent]

  return (
    <span
      className={['relative inline-flex shrink-0 items-center', className].filter(Boolean).join(' ')}
      style={{ width: TRACK_WIDTH, height: TRACK_HEIGHT }}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
        {...rest}
      />
      {/* Focus is drawn with `outline`, the app's one focus treatment. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white/80 peer-disabled:opacity-40"
        style={{
          borderColor: checked ? color : tokens.surface.line,
          background: checked ? color : tokens.surface.raised,
        }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute rounded-full peer-disabled:opacity-40"
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          left: KNOB_INSET,
          background: checked ? '#0a0a0c' : 'rgba(242,242,244,.8)',
          boxShadow: '0 1px 3px rgba(0,0,0,.45)',
        }}
        animate={{ x: checked ? KNOB_TRAVEL : 0 }}
        transition={reduceMotion ? { duration: 0 } : tokens.spring.press}
      />
    </span>
  )
}
