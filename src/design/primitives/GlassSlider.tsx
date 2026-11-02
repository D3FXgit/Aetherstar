import type { CSSProperties, InputHTMLAttributes } from 'react'
import { tokens } from '../tokens'

type Accent = keyof typeof tokens.accent

interface GlassSliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'value' | 'min' | 'max' | 'step'> {
  value: number
  onChange: (value: number) => void
  /** Accessible name, set as `aria-label`: the visible label lives in the row beside the control. */
  label: string
  min?: number
  max?: number
  step?: number
  /** Rendered beside the track, e.g. "40%". Decoration -- the input carries the real value. */
  valueText?: string
  accent?: Accent
}

const TRACK_HEIGHT = 6
const THUMB_SIZE = 22

/**
 * Track and thumb paint. Chromium only (this is Electron), driven by custom
 * properties because a pseudo-element cannot take a `style` prop.
 */
const TRACK_CLASSES = [
  '[&::-webkit-slider-runnable-track]:h-[var(--gs-track-height)]',
  '[&::-webkit-slider-runnable-track]:rounded-full',
  '[&::-webkit-slider-runnable-track]:[background:var(--gs-track-background)]',
  '[&::-webkit-slider-runnable-track]:[box-shadow:inset_0_1px_2px_rgba(0,0,0,.5)]',
].join(' ')

const THUMB_CLASSES = [
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:h-[var(--gs-thumb-size)]',
  '[&::-webkit-slider-thumb]:w-[var(--gs-thumb-size)]',
  '[&::-webkit-slider-thumb]:rounded-full',
  '[&::-webkit-slider-thumb]:[background:var(--gs-thumb-background)]',
  '[&::-webkit-slider-thumb]:[box-shadow:var(--gs-thumb-shadow)]',
  // Centres the thumb on a track that is much shorter than it.
  '[&::-webkit-slider-thumb]:[margin-top:var(--gs-thumb-offset)]',
].join(' ')

/**
 * The app's level control: a solid track with an accent fill. A real
 * `<input type="range">`, so the gamepad focus system, arrow keys and
 * assistive tech all work; only the paint is custom.
 */
export function GlassSlider({
  value,
  onChange,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  valueText,
  accent = 'cyan',
  className,
  disabled,
  ...rest
}: GlassSliderProps) {
  const color = tokens.accent[accent]
  const span = max - min
  const fraction = span === 0 ? 0 : Math.min(1, Math.max(0, (value - min) / span))
  const percent = `${fraction * 100}%`

  const style = {
    '--gs-track-height': `${TRACK_HEIGHT}px`,
    '--gs-thumb-size': `${THUMB_SIZE}px`,
    '--gs-thumb-offset': `${(TRACK_HEIGHT - THUMB_SIZE) / 2}px`,
    // Filled and unfilled halves as one hard-stop gradient, so there is no
    // second element to keep in sync with the thumb position.
    '--gs-track-background': `linear-gradient(to right, ${color} 0 ${percent}, rgba(255,255,255,.14) ${percent} 100%)`,
    '--gs-thumb-background': 'rgba(255,255,255,.92)',
    '--gs-thumb-shadow': '0 1px 4px rgba(0,0,0,.5)',
  } as CSSProperties

  return (
    <span className={['flex min-w-0 items-center gap-3', className].filter(Boolean).join(' ')}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        // 44px tall, not 6px: the input *is* the hit target, and the painted
        // track is a 6px stripe Chromium centres inside it. A 6px-tall control
        // is unhittable with a pointer and invisible from a sofa.
        className={`h-11 w-full min-w-[7rem] cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40 ${TRACK_CLASSES} ${THUMB_CLASSES}`}
        style={style}
        {...rest}
      />
      {valueText ? (
        // `tabular-nums` so the row does not twitch sideways as the number's
        // width changes during a drag.
        <span aria-hidden className="w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-ink-secondary">
          {valueText}
        </span>
      ) : null}
    </span>
  )
}
