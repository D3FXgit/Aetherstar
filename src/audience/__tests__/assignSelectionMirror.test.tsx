import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { setLanguage } from '../../i18n'
import { SelectablePlayerBadge } from '../../session/SelectablePlayerBadge'
import { readAssignSelection, sameSelection, watchAssignSelection } from '../assignSelectionMirror'

afterEach(async () => {
  vi.useRealTimers()
  await setLanguage(null)
})

/**
 * Rendered from the *real* Player Selection badge, not a hand-written fixture:
 * the mirror depends on attributes that component publishes, so the contract
 * has to be pinned to the component itself. If a reskin drops `data-selected`,
 * `data-mic-number` or the "<name>, Mic <n>" label, this fails here rather than
 * silently emptying the audience line-up.
 */
function renderGrid() {
  return render(
    <div>
      <SelectablePlayerBadge name="Sam" avatarUrl="" micNumber={2} size={120} onClick={() => {}} />
      <SelectablePlayerBadge name="Alex" avatarUrl="" micNumber={1} size={120} onClick={() => {}} />
      <SelectablePlayerBadge name="Nobody" avatarUrl="" micNumber={null} size={120} onClick={() => {}} />
    </div>,
  )
}

describe('assignSelectionMirror', () => {
  it('reads only the picked singers, with the mic number the badge is drawing', () => {
    const { container } = renderGrid()
    expect(readAssignSelection(container)).toEqual([
      { name: 'Alex', micNumber: 1 },
      { name: 'Sam', micNumber: 2 },
    ])
  })

  // The badge's label is translated; the name must still come back out.
  it('reads the names back out of a German label', async () => {
    await act(() => setLanguage('de'))
    const { container } = renderGrid()
    expect(readAssignSelection(container)).toEqual([
      { name: 'Alex', micNumber: 1 },
      { name: 'Sam', micNumber: 2 },
    ])
  })

  it('reads the published data-player-name, even when the translated label has no name in it', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<button data-testid="selectable-player-badge" data-selected="true" data-mic-number="1" data-player-name="Alex" aria-label="Mikrofon 1"></button>'
    expect(readAssignSelection(root)).toEqual([{ name: 'Alex', micNumber: 1 }])
  })

  it('never reports a whole label as the name when it cannot be cut back out', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<button data-testid="selectable-player-badge" data-selected="true" data-mic-number="1" aria-label="Mikrofon 1"></button>'
    expect(readAssignSelection(root)).toEqual([])
  })

  it('orders by mic number, not by roster position', () => {
    const { container } = renderGrid()
    expect(readAssignSelection(container).map((pick) => pick.micNumber)).toEqual([1, 2])
  })

  it('reads nothing at all when no one has been picked', () => {
    const { container } = render(
      <SelectablePlayerBadge name="Alex" avatarUrl="" micNumber={null} size={120} onClick={() => {}} />,
    )
    expect(readAssignSelection(container)).toEqual([])
  })

  it('sameSelection compares line-ups by name and mic, so an unchanged screen is not re-broadcast', () => {
    expect(sameSelection([{ name: 'Alex', micNumber: 1 }], [{ name: 'Alex', micNumber: 1 }])).toBe(true)
    expect(sameSelection([{ name: 'Alex', micNumber: 1 }], [{ name: 'Alex', micNumber: 2 }])).toBe(false)
    expect(sameSelection([], [{ name: 'Alex', micNumber: 1 }])).toBe(false)
  })

  it('reports the current line-up immediately and again only when it changes', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(
      <div>
        <SelectablePlayerBadge name="Alex" avatarUrl="" micNumber={1} size={120} onClick={() => {}} />
      </div>,
    )
    expect(container).toBeTruthy()

    const onChange = vi.fn()
    const stop = watchAssignSelection(onChange, 50)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Alex', micNumber: 1 }])

    vi.advanceTimersByTime(200)
    expect(onChange).toHaveBeenCalledTimes(1)

    rerender(
      <div>
        <SelectablePlayerBadge name="Alex" avatarUrl="" micNumber={1} size={120} onClick={() => {}} />
        <SelectablePlayerBadge name="Sam" avatarUrl="" micNumber={2} size={120} onClick={() => {}} />
      </div>,
    )
    vi.advanceTimersByTime(50)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith([
      { name: 'Alex', micNumber: 1 },
      { name: 'Sam', micNumber: 2 },
    ])

    stop()
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
