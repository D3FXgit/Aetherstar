import type { HTMLAttributes, ReactNode } from 'react'
import { tokens } from '../tokens'

type Accent = keyof typeof tokens.accent

interface NeonTextProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  accent?: Accent
  /**
   * Adds the neon halo. Off by default: flat accent text reads better from a
   * sofa. Keep the glow for a moment that should feel like an event (a
   * countdown, a winner), never for ordinary headings.
   */
  glow?: boolean
}

/** Accent-coloured text. */
export function NeonText({ children, accent = 'coral', glow = false, style, ...rest }: NeonTextProps) {
  const color = tokens.accent[accent]

  return (
    <span style={{ color, ...(glow ? { textShadow: `0 0 12px ${color}` } : null), ...style }} {...rest}>
      {children}
    </span>
  )
}

/** The same component under a name that says what it does now, for new code. */
export const AccentText = NeonText
