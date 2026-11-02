import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { PitchLine, type PitchLineHandle } from '../PitchLine'
import { PLAYHEAD_OFFSET_PERCENT } from '../LanePanel'
import { tokens } from '../../../design/tokens'

describe('PitchLine', () => {
  // The value still arrives as a MotionValue, so React never re-renders for it.
  // What changed is *which property it writes*: `top` is a layout-affecting
  // property, so every frame's write invalidated layout for the lane and every
  // note mounted in it. A transform is compositor-only and invalidates nothing.
  // Measured on an M3 Max with eight pitch lines and 320 note pills mounted, as
  // a forced synchronous reflow immediately after each frame's write: 0.06 ms
  // per frame with `top` (p50 0.1 ms) against 0.04 ms with a transform (p50
  // 0.0 ms -- nothing was dirty to lay out). Small in absolute terms; the point
  // is that it is now structurally zero and cannot grow with the lane stack.
  it('positions itself with a compositor-only transform, never the layout-affecting `top`', async () => {
    const y = motionValue(120)
    render(<PitchLine y={y} />)

    const line = screen.getByTestId('pitch-line')
    expect(line.style.transform).toContain('120px')
    expect(line.style.top).toBe('0px')

    // Updating the MotionValue imperatively (as the per-frame rAF loop will)
    // must be reflected without React ever re-rendering this component --
    // framer-motion applies the DOM write on the next animation frame.
    y.set(200)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(line.style.transform).toContain('200px')
    expect(line.style.top).toBe('0px')
  })

  // The one element in the lane that moves every single frame, so the one
  // element worth a permanent compositor layer. `will-change` is not free -- it
  // costs VRAM for the life of the song -- which is exactly why it belongs here
  // and not on the static glass surfaces around it.
  it('is promoted to its own compositor layer, because it moves on every frame', () => {
    render(<PitchLine y={motionValue(0)} />)

    const line = screen.getByTestId('pitch-line')
    expect(line.style.willChange).toContain('transform')
    // translateZ in the transform is what forces the 3D-accelerated path even
    // where will-change alone is ignored.
    expect(line.style.transform).toMatch(/translateZ|translate3d/)
  })

  it('defaults to the cyan accent when no color is given (regression guard)', () => {
    render(<PitchLine y={motionValue(0)} />)
    expect(screen.getByTestId('pitch-line').style.background).toContain('oklch(0.78 0.19 195')
  })

  it('renders with a given color, for per-player pitch lines', () => {
    render(<PitchLine y={motionValue(0)} color={tokens.accent.gold} />)
    expect(screen.getByTestId('pitch-line').style.background).toContain('oklch(0.85 0.16 85')
  })
})

/**
 * The reference frame's pitch indicator is not a stub sitting on the playhead:
 * it is a thin rule running from the field's left edge to the playhead, tipped
 * with an inward-pointing arrowhead. The shape does real work -- the rule
 * crosses everything already sung, so you can see where your pitch sits against
 * the notes you just came off, and the arrowhead names "now" without a second
 * vertical marker competing with it.
 */
describe('PitchLine: the horizontal beat rule', () => {
  it('spans from the field\'s left edge exactly to the playhead, and no further', () => {
    render(<PitchLine y={motionValue(0)} />)

    const line = screen.getByTestId('pitch-line')
    expect(line.style.left).toBe('0px')
    // Ahead of the playhead is un-sung chart; a rule drawn across it would read
    // as a pitch the singer has somehow already hit.
    expect(line.style.width).toBe(`${PLAYHEAD_OFFSET_PERCENT}%`)
  })

  it('reads as a rule, not a bar: a couple of pixels thick', () => {
    render(<PitchLine y={motionValue(0)} />)
    expect(parseFloat(screen.getByTestId('pitch-line').style.height)).toBeLessThanOrEqual(3)
  })

  it('tips the rule with an inward-pointing arrowhead at the playhead', () => {
    render(<PitchLine y={motionValue(0)} color="rgb(0, 200, 120)" />)

    const arrow = screen.getByTestId('pitch-line-arrow')
    // A bordered zero-size box: solid on the left, transparent top and bottom,
    // which is a triangle pointing right -- into the oncoming notes.
    expect(arrow.style.borderLeft).toContain('rgb(0, 200, 120)')
    expect(arrow.style.borderTop).toContain('transparent')
    expect(arrow.style.borderBottom).toContain('transparent')
    expect(arrow.style.left).toBe('100%')
  })

  /**
   * The arrowhead is a *child* of the rule, so it rides the one transform the
   * rule already writes each frame. Giving it its own position write would have
   * doubled the per-frame cost of the one element that moves on every frame.
   */
  it('parents the arrowhead to the rule, so both move on one transform write', () => {
    render(<PitchLine y={motionValue(0)} />)
    expect(screen.getByTestId('pitch-line').contains(screen.getByTestId('pitch-line-arrow'))).toBe(true)
  })
})

/**
 * The pitch line, over the pill the singer is on.
 *
 * The rule used to stop dead at the playhead. That is right about the far side
 * of the lane -- a rule drawn across un-sung chart would read as a pitch
 * already hit -- and wrong about the inch next to it, because a note is judged
 * over its whole span, so the note being sung *right now* extends to the right
 * of the playhead. Stopping short of it meant the one comparison a singer
 * actually needs ("am I on this pill?") was the one the display would not draw.
 */
describe('PitchLine: the lead over the note being sung', () => {
  it('continues a short way past the playhead, onto the pill under it', () => {
    render(<PitchLine y={motionValue(0)} />)

    const lead = screen.getByTestId('pitch-line-lead')
    expect(lead.style.left).toBe('100%')
    expect(Number.parseFloat(lead.style.width)).toBeGreaterThan(0)
  })

  it('reaches the current note and no further -- it is an aim, not a claim', () => {
    render(<PitchLine y={motionValue(0)} />)

    // As a share of the lane: the rule is PLAYHEAD_OFFSET_PERCENT wide and the
    // lead is a percentage of *that*, so the lead must stay a small slice of
    // the lane rather than running out across the upcoming chart.
    const leadPercentOfRule = Number.parseFloat(screen.getByTestId('pitch-line-lead').style.width)
    const leadPercentOfLane = (leadPercentOfRule / 100) * PLAYHEAD_OFFSET_PERCENT
    expect(leadPercentOfLane).toBeGreaterThan(5)
    expect(leadPercentOfLane).toBeLessThan(20)
  })

  it('rides the rule\'s own transform rather than writing a second one', () => {
    render(<PitchLine y={motionValue(90)} />)

    const line = screen.getByTestId('pitch-line')
    const lead = screen.getByTestId('pitch-line-lead')
    expect(line.contains(lead)).toBe(true)
    // The one element that moves every frame writes one transform; nothing
    // parented to it may add another.
    expect(lead.style.transform).toBe('')
  })
})

/**
 * "You are on the note", said by the rule itself.
 *
 * The note pill filling in is the singer's confirmation, and it does not arrive
 * until the note is *over*. This is the same verdict a beat earlier: while the
 * singer is inside the tolerance band on the note under the playhead, the rule
 * hardens. It is a state, not an animation, and it is written from the frame
 * loop that already exists -- so it must cost a DOM write only when it changes.
 */
describe('PitchLine: the on-pitch state', () => {
  function renderWithHandle() {
    const handle: { current: PitchLineHandle | null } = { current: null }
    render(<PitchLine y={motionValue(0)} handle={handle} />)
    return { handle, line: screen.getByTestId('pitch-line') }
  }

  it('starts off, because nobody is singing before the song does', () => {
    render(<PitchLine y={motionValue(0)} />)
    expect(screen.getByTestId('pitch-line')).toHaveAttribute('data-on-pitch', 'false')
  })

  it('hardens while the singer is on the note, and relaxes when they come off it', () => {
    const { handle, line } = renderWithHandle()

    handle.current!.setOnPitch(true)
    expect(line).toHaveAttribute('data-on-pitch', 'true')

    handle.current!.setOnPitch(false)
    expect(line).toHaveAttribute('data-on-pitch', 'false')
  })

  /**
   * The cost guarantee. This is called from `Gameplay`'s `useAnimationFrame`,
   * up to eight times per frame for a whole song; a singer holding one note
   * must cost nothing at all after the first frame of it.
   */
  it('writes nothing at all while the value has not changed', () => {
    const { handle, line } = renderWithHandle()
    handle.current!.setOnPitch(true)

    // A value the component would never itself produce, so any write shows.
    line.dataset.onPitch = 'sentinel'
    for (let frame = 0; frame < 500; frame += 1) handle.current!.setOnPitch(true)

    expect(line.dataset.onPitch).toBe('sentinel')
  })

  it('drops its handle at unmount, so a stale frame loop cannot write to a dead node', () => {
    const handle: { current: PitchLineHandle | null } = { current: null }
    const { unmount } = render(<PitchLine y={motionValue(0)} handle={handle} />)
    expect(handle.current).not.toBeNull()
    unmount()
    expect(handle.current).toBeNull()
  })

  it('still positions itself by transform while the state changes', () => {
    const { handle, line } = renderWithHandle()
    handle.current!.setOnPitch(true)
    expect(line.style.top).toBe('0px')
    expect(line.style.transform).toMatch(/translateZ|translate3d/)
  })
})
