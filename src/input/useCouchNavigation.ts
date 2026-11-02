import { useEffect } from 'react'
import { useGamepadNavigation } from './useGamepadNavigation'
import { useKeyboardNavigation } from './useKeyboardNavigation'
import { clearDirectionalInput } from './navMode'

/**
 * The one hook the shell mounts: gamepad and keyboard directional navigation,
 * both routed to the same Back handler, plus the pointer listener that takes
 * the app back out of "directional" focus mode.
 *
 * `enabled` exists for the audience window, which shows a scoreboard nobody
 * interacts with — it should neither poll a pad nor answer Escape.
 */
export function useCouchNavigation(onBack: () => void, enabled = true): void {
  useKeyboardNavigation(onBack, enabled)
  useGamepadNavigation(onBack, enabled)

  useEffect(() => {
    if (!enabled) return
    // Touching the mouse means focus rings should go back to the browser's own
    // :focus-visible judgement — no lingering ring on whatever the stick left
    // behind.
    const handlePointerDown = () => clearDirectionalInput()
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [enabled])
}
