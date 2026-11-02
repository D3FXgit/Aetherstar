import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  activateFocused,
  adjustFocused,
  findInDirection,
  focusScope,
  getFocusableElements,
  isNativelyActivatable,
  isTextEntryElement,
  moveFocus,
  type Bounds,
} from '../spatialNavigation'

function box(left: number, top: number, width = 100, height = 40): Bounds {
  return { left, top, right: left + width, bottom: top + height }
}

describe('findInDirection', () => {
  // A 3x2 grid, the shape of the song grid this exists for.
  const grid = {
    a: box(0, 0),
    b: box(120, 0),
    c: box(240, 0),
    d: box(0, 60),
    e: box(120, 60),
    f: box(240, 60),
  }
  const candidatesExcept = (self: keyof typeof grid) =>
    (Object.entries(grid) as [keyof typeof grid, Bounds][])
      .filter(([name]) => name !== self)
      .map(([name, rect]) => ({ element: name, rect }))

  it('moves right to the immediate neighbour, not the far one', () => {
    expect(findInDirection(grid.a, candidatesExcept('a'), 'right')).toBe('b')
  })

  it('moves left to the immediate neighbour', () => {
    expect(findInDirection(grid.c, candidatesExcept('c'), 'left')).toBe('b')
  })

  // The whole reason this is spatial rather than DOM-order: 'b' is followed in
  // the DOM by 'c', but Down from 'b' has to mean the card underneath it.
  it('moves down to the cell underneath, not the next cell in DOM order', () => {
    expect(findInDirection(grid.b, candidatesExcept('b'), 'down')).toBe('e')
  })

  it('moves up to the cell above', () => {
    expect(findInDirection(grid.f, candidatesExcept('f'), 'up')).toBe('c')
  })

  it('returns null at the edge of the grid', () => {
    expect(findInDirection(grid.a, candidatesExcept('a'), 'up')).toBeNull()
    expect(findInDirection(grid.a, candidatesExcept('a'), 'left')).toBeNull()
  })

  // A tall sidebar entry and a short row are still "the same column" when they
  // overlap horizontally.
  it('prefers a candidate that overlaps on the cross axis over a nearer one that does not', () => {
    const from = box(0, 0, 200, 40)
    const overlapping = { element: 'below', rect: box(0, 200, 200, 40) }
    const offToTheSide = { element: 'aside', rect: box(400, 60, 100, 40) }
    expect(findInDirection(from, [overlapping, offToTheSide], 'down')).toBe('below')
  })

  it('ignores candidates that are level with the origin on the pressed axis', () => {
    const from = box(0, 0)
    const level = { element: 'level', rect: box(120, 0) }
    expect(findInDirection(from, [level], 'down')).toBeNull()
  })
})

describe('isTextEntryElement', () => {
  it.each(['text', 'search', 'password', 'number', 'range'])('is true for <input type="%s">', (type) => {
    const input = document.createElement('input')
    input.type = type
    expect(isTextEntryElement(input)).toBe(true)
  })

  it('is true for textarea and select', () => {
    expect(isTextEntryElement(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryElement(document.createElement('select'))).toBe(true)
  })

  it('is true for a contenteditable element', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(isTextEntryElement(div)).toBe(true)
  })

  it('is false for buttons, checkboxes and nothing at all', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isTextEntryElement(document.createElement('button'))).toBe(false)
    expect(isTextEntryElement(checkbox)).toBe(false)
    expect(isTextEntryElement(null)).toBe(false)
  })
})

describe('isNativelyActivatable', () => {
  it('is true for a button and false for a tabindex div', () => {
    expect(isNativelyActivatable(document.createElement('button'))).toBe(true)
    expect(isNativelyActivatable(document.createElement('div'))).toBe(false)
  })
})

describe('DOM helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('getFocusableElements', () => {
    it('collects standard focusable elements so every screen works with no per-screen wiring', () => {
      document.body.innerHTML = `
        <button id="one">One</button>
        <a id="two" href="#x">Two</a>
        <input id="three" />
        <div id="four" tabindex="0"></div>
        <div id="not-focusable"></div>
      `
      expect(getFocusableElements().map((element) => element.id)).toEqual(['one', 'two', 'three', 'four'])
    })

    it('skips disabled, tabindex="-1", hidden and aria-hidden elements', () => {
      document.body.innerHTML = `
        <button id="ok">Ok</button>
        <button id="off" disabled>Off</button>
        <button id="untabbable" tabindex="-1">Untabbable</button>
        <button id="display-none" style="display:none">Invisible</button>
        <div aria-hidden="true"><button id="aria-hidden">Hidden</button></div>
      `
      expect(getFocusableElements().map((element) => element.id)).toEqual(['ok'])
    })
  })

  describe('focusScope', () => {
    it('confines navigation to the topmost [data-focus-scope] container while one is open', () => {
      document.body.innerHTML = `
        <button id="behind">Behind</button>
        <div data-focus-scope><button id="in-dialog">In dialog</button></div>
      `
      expect(getFocusableElements(focusScope()).map((element) => element.id)).toEqual(['in-dialog'])
    })

    it('falls back to the whole document when no scope is open', () => {
      document.body.innerHTML = '<button id="anywhere">Anywhere</button>'
      expect(focusScope()).toBe(document)
    })
  })

  describe('moveFocus', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <button id="left">Left</button>
        <button id="right">Right</button>
      `
      const rects: Record<string, Bounds> = { left: box(0, 0), right: box(200, 0) }
      for (const element of Array.from(document.querySelectorAll('button'))) {
        // jsdom has no layout, so the geometry the algorithm reads is stubbed.
        element.getBoundingClientRect = () => ({ ...rects[element.id]!, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) })
      }
    })

    it('focuses the first element when nothing is focused yet', () => {
      expect(moveFocus('down')).toBe(true)
      expect(document.activeElement?.id).toBe('left')
    })

    it('moves focus spatially from the focused element', () => {
      document.getElementById('left')!.focus()
      expect(moveFocus('right')).toBe(true)
      expect(document.activeElement?.id).toBe('right')
    })

    it('reports false and leaves focus alone at the edge', () => {
      document.getElementById('right')!.focus()
      expect(moveFocus('right')).toBe(false)
      expect(document.activeElement?.id).toBe('right')
    })
  })

  describe('activateFocused', () => {
    it('clicks the focused element', () => {
      document.body.innerHTML = '<button id="go">Go</button>'
      const button = document.getElementById('go') as HTMLButtonElement
      const onClick = vi.fn()
      button.addEventListener('click', onClick)
      button.focus()

      expect(activateFocused()).toBe(true)
      expect(onClick).toHaveBeenCalledOnce()
    })

    it('does nothing when focus is on the body', () => {
      document.body.innerHTML = ''
      expect(activateFocused()).toBe(false)
    })
  })
})

describe('adjustFocused', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function focusedControl(optIn: boolean) {
    const button = document.createElement('button')
    if (optIn) button.setAttribute('data-dpad-horizontal', 'adjust')
    document.body.appendChild(button)
    button.focus()
    const keys: KeyboardEvent[] = []
    button.addEventListener('keydown', (event) => keys.push(event))
    return keys
  }

  it('hands Left/Right to an opted-in focused control as a bubbling, cancelable keydown', () => {
    const keys = focusedControl(true)
    const atWindow: string[] = []
    const onWindow = (event: KeyboardEvent) => atWindow.push(event.key)
    window.addEventListener('keydown', onWindow)

    expect(adjustFocused('right')).toBe(true)
    expect(adjustFocused('left')).toBe(true)

    window.removeEventListener('keydown', onWindow)
    expect(keys.map((event) => event.key)).toEqual(['ArrowRight', 'ArrowLeft'])
    expect(keys.every((event) => event.bubbles && event.cancelable)).toBe(true)
    // Bubbles, so React's delegated handler and the keyboard hook see it like a real key.
    expect(atWindow).toEqual(['ArrowRight', 'ArrowLeft'])
  })

  it('leaves Up/Down to normal navigation, even on an opted-in control', () => {
    const keys = focusedControl(true)
    expect(adjustFocused('up')).toBe(false)
    expect(adjustFocused('down')).toBe(false)
    expect(keys).toHaveLength(0)
  })

  it('does nothing for a control that has not opted in', () => {
    const keys = focusedControl(false)
    expect(adjustFocused('right')).toBe(false)
    expect(keys).toHaveLength(0)
  })

  it('does nothing with nothing focused', () => {
    expect(adjustFocused('left')).toBe(false)
  })
})
