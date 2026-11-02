import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SelectablePlayerBadge } from '../SelectablePlayerBadge'
import { MIC_RIM_COLORS } from '../../design/tokens'
import { BORDER_RADIUS_PERCENT } from '../../players/PlayerBadge'

function renderBadge(props: Partial<React.ComponentProps<typeof SelectablePlayerBadge>> = {}) {
  return render(
    <SelectablePlayerBadge name="Alex" avatarUrl="" micNumber={null} size={190} onClick={() => {}} {...props} />,
  )
}

describe('SelectablePlayerBadge', () => {
  it('renders the roster avatar', () => {
    renderBadge()
    expect(screen.getByTestId('player-badge')).toBeInTheDocument()
  })

  it('names the player in text rather than leaving initials to do the work', () => {
    renderBadge()
    expect(screen.getByText('Alex')).toBeInTheDocument()
  })

  it('is unselected when it holds no mic', () => {
    renderBadge()
    expect(screen.getByTestId('selectable-player-badge')).toHaveAttribute('data-selected', 'false')
  })

  it('is selected when it holds a mic', () => {
    renderBadge({ micNumber: 3 })
    expect(screen.getByTestId('selectable-player-badge')).toHaveAttribute('data-selected', 'true')
  })

  // data-selected is a test hook; assistive technology needs the pressed state.
  it('exposes the selection to assistive technology as a pressed toggle', () => {
    renderBadge({ micNumber: 1 })
    expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument()
  })

  it('exposes the unpressed state too, so the control reads as a toggle even when off', () => {
    renderBadge()
    expect(screen.getByRole('button', { pressed: false })).toBeInTheDocument()
  })

  it('fires onClick when clicked', () => {
    const onClick = vi.fn()
    renderBadge({ onClick })
    fireEvent.click(screen.getByTestId('selectable-player-badge'))
    expect(onClick).toHaveBeenCalled()
  })
})

/**
 * The mic number is the identifier; the rim colour only reinforces it.
 */
describe('SelectablePlayerBadge mic identity', () => {
  it('names the mic in readable text, not colour alone', () => {
    renderBadge({ micNumber: 3 })

    expect(screen.getByTestId('mic-number-badge')).toHaveTextContent(/^mic 3$/i)
  })

  it('reads the mic number out as part of the accessible name', () => {
    renderBadge({ micNumber: 3 })

    expect(screen.getByRole('button', { name: /alex.*mic 3/i })).toBeInTheDocument()
  })

  it('shows no mic badge until the player is picked', () => {
    renderBadge()

    expect(screen.queryByTestId('mic-number-badge')).not.toBeInTheDocument()
  })

  it('takes the rim colour from the mic slot', () => {
    renderBadge({ micNumber: 2 })

    expect(screen.getByTestId('badge-rim')).toHaveStyle({ borderColor: MIC_RIM_COLORS[1] })
  })

  it('draws no rim colour at all when the player holds no mic, so no profile owns a colour', () => {
    renderBadge()

    expect(screen.getByTestId('badge-rim').style.borderColor).toBe('transparent')
  })

  // The mic number is what the numbered input on the mixer says; wrapping past
  // eight would be a lie, and the caller caps selection long before here.
  it('reuses the palette by slot index, so mic 1 is always the same colour', () => {
    const { unmount } = renderBadge({ micNumber: 1, name: 'Alex' })
    const first = screen.getByTestId('badge-rim').style.borderColor
    unmount()

    renderBadge({ micNumber: 1, name: 'Bea' })
    expect(screen.getByTestId('badge-rim').style.borderColor).toBe(first)
  })
})

/**
 * The overlap regression. `scale` is a transform: it paints outside the box and
 * reserves no layout space, so if the button's own footprint changed with
 * selection *as well*, the grid would reflow under the pointer. The footprint
 * is fixed; the growth is transform-only and lives in the gutter.
 */
describe('SelectablePlayerBadge footprint stability', () => {
  it('occupies exactly the size it was given, selected or not', () => {
    const { unmount } = renderBadge({ size: 190 })
    const unselected = screen.getByTestId('selectable-player-badge').style.width
    unmount()

    renderBadge({ size: 190, micNumber: 1 })
    expect(screen.getByTestId('selectable-player-badge').style.width).toBe(unselected)
    expect(unselected).toBe('190px')
  })

  it('reserves the mic badge row even when empty, so picking someone shifts nothing', () => {
    const { unmount } = renderBadge()
    const unselected = screen.getByTestId('mic-badge-row').style.minHeight
    unmount()

    renderBadge({ micNumber: 1 })
    expect(screen.getByTestId('mic-badge-row').style.minHeight).toBe(unselected)
    expect(unselected).not.toBe('')
  })

  // Drawn inside the badge's own box: an outset ring would sit in the focus
  // outline's band (and mic 1's rim is the same cyan as the focus ring).
  it('draws the rim inside its own box so nothing sits in the focus outline band', () => {
    renderBadge({ micNumber: 1, size: 190 })

    const rim = screen.getByTestId('badge-rim')
    expect(rim.style.boxShadow).toBe('')
    expect(rim.style.outline).toBe('')
    expect(Number.parseInt(rim.style.borderWidth, 10)).toBeGreaterThan(0)
  })

  // The rim's corners follow the avatar's corners at a constant distance, so the
  // coloured band is equally wide along the sides and around the corners.
  it('rounds the rim concentrically with the avatar inside it', () => {
    renderBadge({ micNumber: 1, size: 190 })

    const rim = screen.getByTestId('badge-rim')
    const avatar = screen.getByTestId('player-badge')
    const rimRadius = Number.parseFloat(rim.style.borderRadius)
    const avatarSize = Number.parseFloat(avatar.style.width)
    const avatarRadius = (avatarSize * BORDER_RADIUS_PERCENT) / 100
    const gap = (190 - avatarSize) / 2

    expect(rim.style.borderRadius).toMatch(/px$/)
    expect(rimRadius).toBeCloseTo(avatarRadius + gap, 5)
  })

  it('never clips: no ancestor of the avatar hides overflow', () => {
    renderBadge({ micNumber: 1 })

    expect(screen.getByTestId('selectable-player-badge').style.overflow).not.toBe('hidden')
    expect(screen.getByTestId('badge-rim').style.overflow).not.toBe('hidden')
  })
})

describe('SelectablePlayerBadge when every mic is taken', () => {
  it('says it cannot be picked instead of just ignoring the press', () => {
    renderBadge({ disabled: true })

    expect(screen.getByTestId('selectable-player-badge')).toHaveAttribute('aria-disabled', 'true')
  })

  it('stays reachable by the couch focus system rather than dropping out of the focus order', () => {
    renderBadge({ disabled: true })

    expect(screen.getByTestId('selectable-player-badge')).not.toBeDisabled()
  })

  it('does not fire onClick', () => {
    const onClick = vi.fn()
    renderBadge({ disabled: true, onClick })

    fireEvent.click(screen.getByTestId('selectable-player-badge'))

    expect(onClick).not.toHaveBeenCalled()
  })
})
