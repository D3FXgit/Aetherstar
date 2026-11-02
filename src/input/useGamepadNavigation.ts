import { useEffect, useRef } from 'react'
import { activateFocused, adjustFocused, moveFocus, type Direction } from './spatialNavigation'
import { markDirectionalInput } from './navMode'

/**
 * Gamepad navigation for the whole shell: D-pad or left stick moves focus, A
 * activates, B goes back. The pad must be polled, so a rAF loop runs only while
 * one is connected, and all state lives in closures so idle frames never render.
 */

/** How far the stick must leave centre to register — below this it is drift. */
const AXIS_DEADZONE = 0.5
/** First repeat after a direction is held. Long enough that a tap is one step. */
const REPEAT_DELAY_MS = 400
/** Repeat cadence while held — fast enough to cross a grid, slow enough to stop on a card. */
const REPEAT_INTERVAL_MS = 140

const BUTTON_A = 0
const BUTTON_B = 1

const DPAD_DIRECTIONS: Readonly<Record<number, Direction>> = {
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
}

const AXIS_HORIZONTAL = 0
const AXIS_VERTICAL = 1

function directionFromPad(pad: Gamepad): Direction | null {
  for (const [index, direction] of Object.entries(DPAD_DIRECTIONS)) {
    if (pad.buttons[Number(index)]?.pressed) return direction
  }

  const x = pad.axes[AXIS_HORIZONTAL] ?? 0
  const y = pad.axes[AXIS_VERTICAL] ?? 0
  const pastDeadzone = (value: number) => Math.abs(value) >= AXIS_DEADZONE

  // Whichever axis is pushed further wins, so a diagonal resolves to one step
  // instead of firing both.
  if (pastDeadzone(x) && Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left'
  if (pastDeadzone(y)) return y > 0 ? 'down' : 'up'
  return null
}

export function useGamepadNavigation(onBack: () => void, enabled = true): void {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return

    let frame: number | null = null
    let heldDirection: Direction | null = null
    let repeatAt = 0
    const pressedButtons = new Set<number>()

    const connectedPads = (): Gamepad[] =>
      Array.from(navigator.getGamepads() ?? []).filter((pad): pad is Gamepad => pad !== null)

    const step = (direction: Direction) => {
      markDirectionalInput()
      // A focused control that opted into Left/Right (data-dpad-horizontal)
      // gets the press as a key instead; everything else moves focus.
      if (adjustFocused(direction)) return
      moveFocus(direction)
    }

    const readPad = (pad: Gamepad, now: number) => {
      const direction = directionFromPad(pad)

      if (direction === null) {
        heldDirection = null
      } else if (direction !== heldDirection) {
        heldDirection = direction
        repeatAt = now + REPEAT_DELAY_MS
        step(direction)
      } else if (now >= repeatAt) {
        repeatAt = now + REPEAT_INTERVAL_MS
        step(direction)
      }

      // Edge-triggered: A and B fire once per press, never once per frame.
      for (const index of [BUTTON_A, BUTTON_B]) {
        const down = pad.buttons[index]?.pressed ?? false
        if (!down) {
          pressedButtons.delete(index)
          continue
        }
        if (pressedButtons.has(index)) continue
        pressedButtons.add(index)

        if (index === BUTTON_A) {
          markDirectionalInput()
          activateFocused()
        } else {
          onBackRef.current()
        }
      }
    }

    const poll = (now: number) => {
      frame = null
      const pads = connectedPads()
      if (pads.length === 0) {
        // Nothing to read: fall idle rather than burning a frame forever. The
        // gamepadconnected listener wakes us back up.
        heldDirection = null
        pressedButtons.clear()
        return
      }
      // One pad drives the menus — whichever is reporting input first.
      readPad(pads[0]!, now)
      frame = requestAnimationFrame(poll)
    }

    const start = () => {
      if (frame === null) frame = requestAnimationFrame(poll)
    }

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      heldDirection = null
      pressedButtons.clear()
    }

    const handleConnected = () => start()
    const handleDisconnected = () => {
      if (connectedPads().length === 0) stop()
    }

    window.addEventListener('gamepadconnected', handleConnected)
    window.addEventListener('gamepaddisconnected', handleDisconnected)

    // A pad plugged in before the app started never fires `gamepadconnected`.
    if (connectedPads().length > 0) start()

    return () => {
      window.removeEventListener('gamepadconnected', handleConnected)
      window.removeEventListener('gamepaddisconnected', handleDisconnected)
      stop()
    }
  }, [enabled])
}
