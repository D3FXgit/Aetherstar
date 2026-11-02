// Keyboard, gamepad and pointer input for the jukebox's playback screen, on top
// of the shell's couch navigation (arrows/D-pad move focus, Enter/A activate,
// Escape/Backspace/B go Back -- which the scene routes to its overlays first).
//
//   Space / K / Start          play or pause
//   ← / →  (LT / RT)           seek 10 s back / forward
//   P / N  (LB / RB)           previous / next
//   Q      (Y)                 the Up next panel
//   ↑ / ↓  (D-pad)             bring up the transport bar, focus on Play
//
// Any key, button, stick or mouse move brings the transport bar back up.
import { useEffect, useRef } from 'react'
import { isNativelyActivatable, isTextEntryElement } from '../input/spatialNavigation'
import { isDirectionalInput, markDirectionalInput } from '../input/navMode'
import { useSessionStore } from '../session/sessionStore'
import { useJukeboxUiStore } from './jukeboxUiStore'
import { SEEK_STEP_SEC, VOLUME_STEP, nudgeMusicVolume, type JukeboxTransport } from './transport'

export const GAMEPAD_BUTTON_Y = 3
export const GAMEPAD_BUTTON_LB = 4
export const GAMEPAD_BUTTON_RB = 5
export const GAMEPAD_BUTTON_LT = 6
export const GAMEPAD_BUTTON_RT = 7
export const GAMEPAD_BUTTON_START = 9
const DPAD_LEFT = 14
const DPAD_RIGHT = 15
const DPAD_BUTTONS = [12, 13, DPAD_LEFT, DPAD_RIGHT]
const AXIS_DEADZONE = 0.5
/** Mouse moves (or held-stick frames) closer together than this count as one, so they are not a render each. */
const POINTER_REVEAL_INTERVAL_MS = 200

/** Marks the transport bar's root, so key handling can tell where focus is. */
export const TRANSPORT_ATTRIBUTE = 'data-jukebox-transport'
/** Marks the seek bar, the one control in the bar that ←/→ seek on instead of leaving. */
export const SEEK_ATTRIBUTE = 'data-jukebox-seek'

function focusInTransport(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active.closest(`[${TRANSPORT_ATTRIBUTE}]`) ? active : null
}

/** Something sits over the song that owns its own input: the menu, the song browser, the finished card. */
function modalOpen(): boolean {
  const session = useSessionStore.getState()
  return session.jukeboxMenuOpen || session.jukeboxFinished || useJukeboxUiStore.getState().addSongsOpen
}

export function useJukeboxInput(transport: JukeboxTransport): void {
  const transportRef = useRef(transport)
  transportRef.current = transport

  // Keyboard. Captured, so ←/→ can seek before the shell's arrow navigation
  // moves focus, and so a handled key is marked for the listeners after it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const ui = useJukeboxUiStore.getState()
      ui.reveal()
      if (modalOpen()) return

      const target = event.target instanceof Element ? event.target : null
      const typing = isTextEntryElement(target)
      const key = event.key
      const actions = transportRef.current

      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
      }

      if ((key === 'q' || key === 'Q') && !typing) {
        if (event.repeat) return
        consume()
        ui.toggleQueue()
        return
      }
      // The panel is navigated like any list; the volume slider keeps its arrows.
      if (ui.queueOpen || typing) return

      switch (key) {
        case ' ':
        case 'k':
        case 'K':
        case 'MediaPlayPause':
          // Space on a focused button presses that button.
          if (key === ' ' && isNativelyActivatable(document.activeElement)) return
          consume()
          if (!event.repeat) actions.togglePlay()
          return
        case 'n':
        case 'N':
        case 'MediaTrackNext':
          consume()
          if (!event.repeat) actions.next()
          return
        case 'p':
        case 'P':
        case 'MediaTrackPrevious':
          consume()
          if (!event.repeat) actions.previous()
          return
        case 'ArrowLeft':
        case 'ArrowRight': {
          const focused = focusInTransport()
          // Walking the bar's buttons with the arrows: the shell moves focus.
          if (focused && !focused.hasAttribute(SEEK_ATTRIBUTE) && isDirectionalInput()) return
          consume()
          actions.seekBy(key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC)
          return
        }
        case 'ArrowUp':
        case 'ArrowDown':
          if (focusInTransport()) return
          consume()
          markDirectionalInput()
          ui.focusTransport()
          return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // Pointer: moving the mouse brings the bar back.
  useEffect(() => {
    let last = -Infinity
    const handlePointerMove = () => {
      const now = performance.now()
      if (now - last < POINTER_REVEAL_INTERVAL_MS) return
      last = now
      useJukeboxUiStore.getState().reveal()
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerdown', handlePointerMove)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerMove)
    }
  }, [])

  // Gamepad: polled, only while a pad is connected. The first frame only reads
  // the buttons, so one still held from the song list never fires here.
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return
    let frame: number | null = null
    let primed = false
    let lastRevealAt = -Infinity
    /** Focus as the last poll left it -- before the shell's D-pad handling can move it this frame. */
    let focusedBefore: Element | null = null
    const held = new Set<number>()

    /**
     * The D-pad on the seek bar or the volume slider adjusts it rather than
     * leaving it. The shell moves focus on the same press, so focus is put
     * back once both have run.
     */
    const adjust = (element: HTMLElement, direction: -1 | 1): boolean => {
      const kind = element.getAttribute('data-jukebox-adjust')
      if (kind === 'seek') transportRef.current.seekBy(direction * SEEK_STEP_SEC)
      else if (kind === 'volume') nudgeMusicVolume(direction * VOLUME_STEP)
      else return false
      requestAnimationFrame(() => requestAnimationFrame(() => element.focus()))
      return true
    }

    const connectedPads = (): Gamepad[] =>
      Array.from(navigator.getGamepads() ?? []).filter((pad): pad is Gamepad => pad !== null)

    const press = (index: number) => {
      const ui = useJukeboxUiStore.getState()
      ui.reveal()
      if (modalOpen()) return
      const actions = transportRef.current
      switch (index) {
        case GAMEPAD_BUTTON_Y:
          ui.toggleQueue()
          return
        case GAMEPAD_BUTTON_START:
          actions.togglePlay()
          return
        case GAMEPAD_BUTTON_LB:
          actions.previous()
          return
        case GAMEPAD_BUTTON_RB:
          actions.next()
          return
        case GAMEPAD_BUTTON_LT:
          actions.seekBy(-SEEK_STEP_SEC)
          return
        case GAMEPAD_BUTTON_RT:
          actions.seekBy(SEEK_STEP_SEC)
          return
      }
      if ((index === DPAD_LEFT || index === DPAD_RIGHT) && focusedBefore instanceof HTMLElement) {
        if (focusedBefore.closest(`[${TRANSPORT_ATTRIBUTE}]`) && adjust(focusedBefore, index === DPAD_LEFT ? -1 : 1)) return
      }
      // The D-pad: the first press lands on Play rather than wherever the
      // shell's "nothing focused yet" rule would put it.
      if (DPAD_BUTTONS.includes(index) && !ui.queueOpen && !focusInTransport()) ui.focusTransport()
    }

    const poll = () => {
      frame = null
      const pad = connectedPads()[0]
      if (!pad) {
        primed = false
        held.clear()
        return
      }
      let anyInput = pad.axes.some((value) => Math.abs(value) >= AXIS_DEADZONE)
      pad.buttons.forEach((button, index) => {
        if (!button.pressed) {
          held.delete(index)
          return
        }
        anyInput = true
        if (held.has(index)) return
        held.add(index)
        if (primed) press(index)
      })
      // A held stick keeps the bar up without re-rendering every frame.
      const now = performance.now()
      if (primed && anyInput && now - lastRevealAt >= POINTER_REVEAL_INTERVAL_MS) {
        lastRevealAt = now
        useJukeboxUiStore.getState().reveal()
      }
      primed = true
      focusedBefore = document.activeElement
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
  }, [])
}
