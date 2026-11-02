import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { act, render } from '@testing-library/react'
import { useGamepadNavigation } from '../useGamepadNavigation'
import { clearDirectionalInput, isDirectionalInput } from '../navMode'

// A stand-in pad: only the fields the hook reads.
function pad({ buttons = [], axes = [0, 0] }: { buttons?: number[]; axes?: number[] } = {}): Gamepad {
  const pressed = new Set(buttons)
  return {
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.has(index), touched: false, value: 0 })),
    axes,
    connected: true,
    id: 'test-pad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
  } as unknown as Gamepad
}

const BUTTON_A = 0
const BUTTON_B = 1
const DPAD_RIGHT = 15
const DPAD_DOWN = 13

describe('useGamepadNavigation', () => {
  let pads: (Gamepad | null)[]
  let frames: FrameRequestCallback[]
  let now: number
  let onBack: Mock<() => void>
  let onActivate: Mock<() => void>

  /** Run one rAF turn at `now`, advancing the clock by `deltaMs` first. */
  function tick(deltaMs = 16) {
    now += deltaMs
    const pending = frames
    frames = []
    act(() => {
      for (const frame of pending) frame(now)
    })
  }

  function Harness() {
    useGamepadNavigation(onBack)
    return (
      <div>
        <button id="a" type="button" onClick={onActivate}>
          A
        </button>
        <button id="b" type="button">
          B
        </button>
        <button id="c" type="button">
          C
        </button>
      </div>
    )
  }

  function mount() {
    const result = render(<Harness />)
    for (const [id, left] of [
      ['a', 0],
      ['b', 120],
      ['c', 240],
    ] as const) {
      const element = document.getElementById(id)!
      element.getBoundingClientRect = () =>
        ({ left, top: 0, right: left + 100, bottom: 40, width: 100, height: 40, x: left, y: 0, toJSON: () => ({}) }) as DOMRect
    }
    return result
  }

  beforeEach(() => {
    pads = []
    frames = []
    now = 0
    onBack = vi.fn<() => void>()
    onActivate = vi.fn<() => void>()
    clearDirectionalInput()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    navigator.getGamepads = () => pads as ReturnType<Navigator['getGamepads']>
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearDirectionalInput()
  })

  // Rule 1 of not fighting the gameplay clock: with no controller plugged in
  // there is no loop at all.
  it('does not poll while no gamepad is connected', () => {
    mount()
    expect(frames).toHaveLength(0)
  })

  it('starts polling on gamepadconnected and stops again on gamepaddisconnected', () => {
    mount()

    pads = [pad()]
    act(() => {
      window.dispatchEvent(new Event('gamepadconnected'))
    })
    expect(frames).toHaveLength(1)

    tick()
    expect(frames).toHaveLength(1) // still looping

    pads = []
    act(() => {
      window.dispatchEvent(new Event('gamepaddisconnected'))
    })
    frames = []
    tick()
    expect(frames).toHaveLength(0)
  })

  it('picks up a pad that was already connected before mount', () => {
    pads = [pad()]
    mount()
    expect(frames).toHaveLength(1)
  })

  describe('with a connected pad', () => {
    beforeEach(() => {
      pads = [pad()]
      mount()
      document.getElementById('a')!.focus()
    })

    it('moves focus with the D-pad', () => {
      pads = [pad({ buttons: [DPAD_RIGHT] })]
      tick()
      expect(document.activeElement?.id).toBe('b')
    })

    it('moves focus with the left analog stick', () => {
      pads = [pad({ axes: [1, 0] })]
      tick()
      expect(document.activeElement?.id).toBe('b')
    })

    it('ignores stick drift inside the deadzone', () => {
      pads = [pad({ axes: [0.3, 0.2] })]
      tick()
      expect(document.activeElement?.id).toBe('a')
    })

    it('resolves a diagonal to the axis pushed furthest rather than firing both', () => {
      // Mostly right, a little down: one step right, and 'c' (further right) is
      // never reached in a single frame.
      pads = [pad({ axes: [0.9, 0.6] })]
      tick()
      expect(document.activeElement?.id).toBe('b')
    })

    // A held stick must not fly through the list: one step, then a pause, then
    // a steady repeat.
    it('steps once on a held direction, then repeats only after the repeat delay', () => {
      pads = [pad({ axes: [1, 0] })]
      tick()
      expect(document.activeElement?.id).toBe('b')

      // Several frames well inside the 400ms delay: still on 'b'.
      tick(16)
      tick(16)
      tick(16)
      expect(document.activeElement?.id).toBe('b')

      tick(400)
      expect(document.activeElement?.id).toBe('c')
    })

    it('steps again immediately when the direction changes', () => {
      pads = [pad({ axes: [1, 0] })]
      tick()
      expect(document.activeElement?.id).toBe('b')
      pads = [pad({ axes: [-1, 0] })]
      tick()
      expect(document.activeElement?.id).toBe('a')
    })

    it('A activates the focused element', () => {
      pads = [pad({ buttons: [BUTTON_A] })]
      tick()
      expect(onActivate).toHaveBeenCalledOnce()
    })

    // Edge-triggered: holding A must not re-fire every frame at 60Hz.
    it('A fires once per press, not once per frame', () => {
      pads = [pad({ buttons: [BUTTON_A] })]
      tick()
      tick()
      tick()
      expect(onActivate).toHaveBeenCalledOnce()

      pads = [pad()]
      tick()
      pads = [pad({ buttons: [BUTTON_A] })]
      tick()
      expect(onActivate).toHaveBeenCalledTimes(2)
    })

    it('B goes back', () => {
      pads = [pad({ buttons: [BUTTON_B] })]
      tick()
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('B fires once per press, not once per frame', () => {
      pads = [pad({ buttons: [BUTTON_B] })]
      tick()
      tick()
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('hands Left/Right to a focused control marked data-dpad-horizontal="adjust" instead of moving focus', () => {
      const a = document.getElementById('a')!
      a.setAttribute('data-dpad-horizontal', 'adjust')
      const keys: string[] = []
      // Like SingerDifficultyChip: it uses the key, and claims it.
      a.addEventListener('keydown', (event) => {
        keys.push(event.key)
        event.preventDefault()
      })

      pads = [pad({ buttons: [DPAD_RIGHT] })]
      tick()
      expect(keys).toEqual(['ArrowRight'])
      expect(document.activeElement?.id).toBe('a')

      // Held: repeats as a key too, on the usual repeat schedule.
      tick(500)
      expect(keys).toEqual(['ArrowRight', 'ArrowRight'])
      expect(document.activeElement?.id).toBe('a')
    })

    it('still moves focus horizontally off a control that has not opted in', () => {
      document.getElementById('b')!.setAttribute('data-dpad-horizontal', 'adjust')
      // 'a' has not opted in: Right moves focus as before.
      pads = [pad({ buttons: [DPAD_RIGHT] })]
      tick()
      expect(document.activeElement?.id).toBe('b')
    })

    it('marks the app as directionally navigated so the focus treatment shows', () => {
      expect(isDirectionalInput()).toBe(false)
      pads = [pad({ buttons: [DPAD_DOWN] })]
      tick()
      expect(isDirectionalInput()).toBe(true)
    })
  })
})
