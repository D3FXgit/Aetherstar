import type { HTMLAttributes } from 'react'
import { tokens } from '../tokens'

type BackdropProps = HTMLAttributes<HTMLDivElement>

/** The app's base background behind every scene: near-black with a faint lift at the top. */
export function Backdrop({ className, style, ...rest }: BackdropProps) {
  const classes = ['fixed inset-0 -z-10', className].filter(Boolean).join(' ')
  const background = `radial-gradient(ellipse at top, ${tokens.palette.backgroundAlt}, ${tokens.palette.background})`

  return <div className={classes} style={{ background, ...style }} {...rest} />
}
