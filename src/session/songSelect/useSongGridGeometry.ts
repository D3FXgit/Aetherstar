import { useEffect, useState } from 'react'
import { songGridGeometry, type SongGridGeometry } from '../songGridGeometry'
import { designUnitPx } from './layout'

function sameGeometry(a: SongGridGeometry, b: SongGridGeometry): boolean {
  return a.columns === b.columns && a.cardPx === b.cardPx && a.gapPx === b.gapPx
}

/** The grid geometry for whatever width its host element currently has. */
export function useSongGridGeometry(host: HTMLElement | null): SongGridGeometry {
  const [geometry, setGeometry] = useState(() => songGridGeometry(0, designUnitPx()))

  useEffect(() => {
    if (!host) return
    const update = () => {
      const next = songGridGeometry(host.clientWidth, designUnitPx())
      setGeometry((previous) => (sameGeometry(previous, next) ? previous : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    // The design unit follows the viewport, which can change without this element changing width.
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [host])

  return geometry
}
