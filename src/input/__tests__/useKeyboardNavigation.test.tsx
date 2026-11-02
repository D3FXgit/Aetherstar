import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useKeyboardNavigation } from '../useKeyboardNavigation'
import { isDirectionalInput, clearDirectionalInput } from '../navMode'

function stubRects(rects: Record<string, [number, number]>) {
  for (const [id, [left, top]] of Object.entries(rects)) {
    const element = document.getElementById(id)
    if (!element) continue
    element.getBoundingClientRect = () =>
      ({ left, top, right: left + 100, bottom: top + 40, width: 100, height: 40, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  }
}

function Harness({ onBack, onActivate }: { onBack: () => void; onActivate?: () => void }) {
  useKeyboardNavigation(onBack)
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
      <input id="field" aria-label="Search" />
      <div id="custom" tabIndex={0} onClick={onActivate}>
        Custom
      </div>
    </div>
  )
}

describe('useKeyboardNavigation', () => {
  let onBack: Mock<() => void>
  let onActivate: Mock<() => void>

  beforeEach(() => {
    onBack = vi.fn<() => void>()
    onActivate = vi.fn<() => void>()
    clearDirectionalInput()
    render(<Harness onBack={onBack} onActivate={onActivate} />)
    // Row of buttons, then the input below, then the custom div below that.
    stubRects({ a: [0, 0], b: [120, 0], c: [240, 0], field: [0, 60], custom: [0, 120] })
  })

  afterEach(() => {
    clearDirectionalInput()
  })

  it('moves focus with the arrow keys', async () => {
    document.getElementById('a')!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement?.id).toBe('b')
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement?.id).toBe('a')
  })

  it('marks the app as directionally navigated so the focus treatment shows for a pad-style press', async () => {
    expect(isDirectionalInput()).toBe(false)
    document.getElementById('a')!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(isDirectionalInput()).toBe(true)
  })

  it('sends Escape to Back', async () => {
    await userEvent.keyboard('{Escape}')
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('sends Backspace to Back', async () => {
    document.getElementById('a')!.focus()
    await userEvent.keyboard('{Backspace}')
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('activates a non-native focusable with Enter', async () => {
    document.getElementById('custom')!.focus()
    await userEvent.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('activates a non-native focusable with Space', async () => {
    document.getElementById('custom')!.focus()
    await userEvent.keyboard(' ')
    expect(onActivate).toHaveBeenCalledOnce()
  })

  // Buttons already fire on Enter/Space by themselves; synthesising a second
  // click would start two songs from one press.
  it('does not double-activate a native button, which already fires on Enter itself', async () => {
    document.getElementById('a')!.focus()
    await userEvent.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledOnce()
  })

  describe('while typing', () => {
    it('leaves the arrow keys to the caret', async () => {
      const field = screen.getByLabelText('Search') as HTMLInputElement
      await userEvent.type(field, 'abba')
      await userEvent.keyboard('{ArrowLeft}')
      expect(document.activeElement).toBe(field)
      expect(field.selectionStart).toBe(3)
    })

    it('leaves Space to the text field', async () => {
      const field = screen.getByLabelText('Search') as HTMLInputElement
      await userEvent.type(field, 'a b')
      expect(field.value).toBe('a b')
      expect(document.activeElement).toBe(field)
    })

    it('leaves Backspace to the text field rather than navigating away', async () => {
      const field = screen.getByLabelText('Search') as HTMLInputElement
      await userEvent.type(field, 'abc{Backspace}')
      expect(field.value).toBe('ab')
      expect(onBack).not.toHaveBeenCalled()
    })
  })

  it('fires Back once for a held Escape or Backspace, ignoring auto-repeat', () => {
    document.getElementById('a')!.focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'Escape', repeat: true })
    fireEvent.keyDown(window, { key: 'Escape', repeat: true })
    expect(onBack).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Backspace' })
    fireEvent.keyDown(window, { key: 'Backspace', repeat: true })
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it('keeps auto-repeat on the arrows, so a held arrow keeps moving', () => {
    document.getElementById('a')!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', repeat: true })
    expect(document.activeElement?.id).toBe('c')
  })

  it('activates a custom focusable once for a held Enter', () => {
    document.getElementById('custom')!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', repeat: true })
    expect(onActivate).toHaveBeenCalledTimes(1)
  })
})
