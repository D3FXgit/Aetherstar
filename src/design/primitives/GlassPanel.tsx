import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { glassSurfaceClass, solidSurfaceClass } from '../tokens'

/** `solid` for menus (the default); `glass` only for a panel floating over video. */
export type SurfaceVariant = 'solid' | 'glass'

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  variant?: SurfaceVariant
}

// forwardRef so a consumer like @dnd-kit's useSortable can attach to the node.
export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { children, className, variant = 'solid', ...rest },
  ref,
) {
  const surface = variant === 'glass' ? glassSurfaceClass() : solidSurfaceClass()
  const classes = [surface, 'rounded-2xl', className].filter(Boolean).join(' ')

  return (
    <div ref={ref} data-surface={variant} className={classes} {...rest}>
      {children}
    </div>
  )
})

/** The same component under its material-neutral name, for new code. */
export const Panel = GlassPanel
