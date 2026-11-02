import { useEffect, useRef } from 'react'

/** Standard-mapping Start / Options / Menu button. */
const BUTTON_START = 9

/**
 * Calls `onPress` once per press of a gamepad's Start button.
 *
 * The shell's couch navigation maps only A and B, and Start is the button every
 * console game pauses on. Polls only while a pad is connected; the first frame
 * just reads the button, so a Start still held from an earlier screen never
 * fires on mount.
 */
export function usePauseGamepadStart(onPress: () => void, enabled = true): void {
  const onPressRef = useRef(onPress)
  onPressRef.current = onPress

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return

    let frame: number | null = null
    let primed = false
    let wasDown = false

    const connectedPads = (): Gamepad[] =>
      Array.from(navigator.getGamepads() ?? []).filter((pad): pad is Gamepad => pad !== null)

    const poll = () => {
      frame = null
      const pads = connectedPads()
      if (pads.length === 0) {
        primed = false
        wasDown = false
        return
      }
      const down = pads.some((pad) => pad.buttons[BUTTON_START]?.pressed ?? false)
      if (primed && down && !wasDown) onPressRef.current()
      primed = true
      wasDown = down
      frame = requestAnimationFrame(poll)
    }

    const start = () => {
      if (frame === null) frame = requestAnimationFrame(poll)
    }

    window.addEventListener('gamepadconnected', start)
    if (connectedPads().length > 0) start()

    return () => {
      window.removeEventListener('gamepadconnected', start)
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    }
  }, [enabled])
}
