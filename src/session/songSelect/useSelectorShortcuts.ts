import { useEffect, useRef } from 'react'
import { isTextEntryElement } from '../../input/spatialNavigation'

export const GAMEPAD_BUTTON_X = 2
export const GAMEPAD_BUTTON_Y = 3

interface SelectorShortcuts {
  onFavorite: () => void
  /** Absent outside the jukebox. */
  onAddToQueue?: () => void
}

function dialogOpen(): boolean {
  return document.querySelector('[data-focus-scope]') !== null
}

/**
 * The selector's extra buttons, on top of the shell's A/B/stick navigation:
 *
 *   Y  / F   star or unstar the selected song
 *   X  / Q   add the selected song to the jukebox queue (jukebox only)
 *
 * Ignored while typing, with a modifier held, or while a dialog holds focus.
 */
export function useSelectorShortcuts(shortcuts: SelectorShortcuts): void {
  const ref = useRef(shortcuts)
  ref.current = shortcuts

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (isTextEntryElement(event.target instanceof Element ? event.target : null) || dialogOpen()) return
      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        ref.current.onFavorite()
      } else if (key === 'q' && ref.current.onAddToQueue) {
        event.preventDefault()
        ref.current.onAddToQueue()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // The Gamepad API has no events: poll, but only while a pad is connected.
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return
    let frame: number | null = null
    const held = new Set<number>()

    const poll = () => {
      frame = null
      const pad = Array.from(navigator.getGamepads() ?? []).find((candidate) => candidate !== null)
      if (!pad) {
        held.clear()
        return
      }
      for (const index of [GAMEPAD_BUTTON_X, GAMEPAD_BUTTON_Y]) {
        const down = pad.buttons[index]?.pressed ?? false
        if (!down) {
          held.delete(index)
          continue
        }
        if (held.has(index)) continue
        held.add(index)
        if (dialogOpen()) continue
        if (index === GAMEPAD_BUTTON_Y) ref.current.onFavorite()
        else ref.current.onAddToQueue?.()
      }
      frame = requestAnimationFrame(poll)
    }
    const start = () => {
      if (frame === null) frame = requestAnimationFrame(poll)
    }

    window.addEventListener('gamepadconnected', start)
    if (Array.from(navigator.getGamepads() ?? []).some((pad) => pad !== null)) start()
    return () => {
      window.removeEventListener('gamepadconnected', start)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])
}
