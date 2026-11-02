import { useEffect, useRef } from 'react'
import {
  activateFocused,
  isNativelyActivatable,
  isTextEntryElement,
  moveFocus,
  type Direction,
} from './spatialNavigation'
import { markDirectionalInput } from './navMode'

/**
 * The keyboard half of couch navigation, for players without a controller in
 * reach: arrows move focus spatially, Enter/Space activate, Escape or
 * Backspace (except while typing) go back.
 */
const ARROW_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

export function useKeyboardNavigation(onBack: () => void, enabled = true): void {
  // Kept in a ref so a caller passing a fresh closure each render never
  // re-binds the listener.
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // A modifier means the player is reaching for a shortcut, not navigating;
      // an already-handled key belongs to whoever handled it.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target instanceof Element ? event.target : null
      const typing = isTextEntryElement(target)

      const direction = ARROW_DIRECTIONS[event.key]
      if (direction) {
        // Never hijack the caret, a range slider, or a native select.
        if (typing) return
        markDirectionalInput()
        if (moveFocus(direction)) event.preventDefault()
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        if (typing) return
        // Buttons, links and inputs already fire on Enter/Space. Synthesising a
        // click on top of that would activate them twice.
        if (isNativelyActivatable(document.activeElement)) return
        // A held key is one press: auto-repeat must not re-activate (toggle)
        // the focused item over and over. Swallowed, so a held Space does not
        // scroll the page either.
        if (event.repeat) {
          event.preventDefault()
          return
        }
        markDirectionalInput()
        if (activateFocused()) event.preventDefault()
        return
      }

      if (event.key === 'Escape' || (event.key === 'Backspace' && !typing)) {
        event.preventDefault()
        // Back is a single step: holding Escape/Backspace must not fire it on
        // every auto-repeat (on the stage, that toggled pause on and off).
        // Arrows above deliberately keep repeating, to scroll through lists.
        if (event.repeat) return
        onBackRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
