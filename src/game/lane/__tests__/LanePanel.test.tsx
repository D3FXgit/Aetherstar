import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LanePanel, LANE_HEIGHT_PX } from '../LanePanel'
import { micLabel } from '../../../multiplayer/slots'
import { laneHeightForPlayerCount } from '../laneStack'

describe('LanePanel', () => {
  it('wraps a singer\'s layers in a lane box of exactly the height the pitch scale maps onto', () => {
    render(
      <LanePanel slotNumber={1} singerName="Alex">
        <div data-testid="layer-a" />
        <div data-testid="layer-b" />
      </LanePanel>,
    )

    const panel = screen.getByTestId('lane-panel')
    expect(screen.getByTestId('layer-a')).toBeInTheDocument()
    expect(screen.getByTestId('layer-b')).toBeInTheDocument()
    expect(screen.getByTestId('lane-track').style.height).toBe(`${LANE_HEIGHT_PX}px`)
    expect(panel).toBeInTheDocument()
  })

  it('takes the shorter lane height a crowded stack needs', () => {
    const height = laneHeightForPlayerCount(8)
    render(
      <LanePanel slotNumber={8} singerName="Sam" laneHeightPx={height}>
        <div />
      </LanePanel>,
    )

    expect(screen.getByTestId('lane-track').style.height).toBe(`${height}px`)
  })

  // The user's requirement, and the reason the lane exists at all: the video
  // behind it has to stay clearly visible.
  it('paints no background of its own, so the video shows through the lane', () => {
    render(
      <LanePanel slotNumber={1} singerName="Alex">
        <div />
      </LanePanel>,
    )

    const track = screen.getByTestId('lane-track')
    expect(track.className).not.toMatch(/\bbg-(?!transparent\b)/)
    expect(track.className).not.toContain('backdrop-blur')
    expect(track.style.background).toBe('')
    expect(track.style.backgroundColor).toBe('')
  })

  it('names the mic slot in words, so colour is never the only thing telling lanes apart', () => {
    render(
      <LanePanel slotNumber={3} singerName="Mira" accentColor="rgb(0, 200, 120)">
        <div />
      </LanePanel>,
    )

    const badge = screen.getByTestId('lane-slot-badge')
    expect(badge).toHaveTextContent('Mic 3')
    expect(screen.getByTestId('lane-singer-name')).toHaveTextContent('Mira')
    // The colour is reinforcement on the rim, exactly as on the mic
    // assignment screen -- the number is the identity.
    expect(screen.getByTestId('lane-rim').style.background).toContain('rgb(0, 200, 120)')
  })

  it('still identifies the lane when nobody claimed a name', () => {
    render(
      <LanePanel slotNumber={2} singerName={null}>
        <div />
      </LanePanel>,
    )

    expect(screen.getByTestId('lane-slot-badge')).toHaveTextContent(micLabel(2))
    expect(screen.queryByTestId('lane-singer-name')).not.toBeInTheDocument()
  })

  it('thins the guide lines out as the lane gets shorter', () => {
    const { unmount } = render(
      <LanePanel slotNumber={1} singerName="Alex">
        <div />
      </LanePanel>,
    )
    const tall = screen.getAllByTestId('lane-guide-line').length
    unmount()

    render(
      <LanePanel slotNumber={1} singerName="Alex" laneHeightPx={laneHeightForPlayerCount(8)}>
        <div />
      </LanePanel>,
    )
    // Nine hairlines across 64px is a hatch pattern, not a guide.
    expect(screen.getAllByTestId('lane-guide-line').length).toBeLessThan(tall)
  })

  it('marks where "now" is', () => {
    render(
      <LanePanel slotNumber={1} singerName="Alex">
        <div />
      </LanePanel>,
    )

    expect(screen.getByTestId('lane-playhead')).toBeInTheDocument()
  })

  it('gives the lane label its own small material rather than a panel behind the whole lane', () => {
    render(
      <LanePanel slotNumber={4} singerName="Kim">
        <div />
      </LanePanel>,
    )

    // Legibility over arbitrary video needs *something* behind the text; a
    // chip the size of the words costs almost none of the video, where a
    // full-lane panel costs all of it.
    // A solid translucent scrim rather than a backdrop blur: eight of these
    // composite over playing video, and a blur re-samples it every frame.
    const chip = screen.getByTestId('lane-identity')
    expect(within(chip).getByTestId('lane-slot-badge')).toBeInTheDocument()
    expect(chip.className).toMatch(/bg-black\/6\d/)
    expect(chip.className).not.toMatch(/backdrop-blur/)
  })

  // Identity follows the *microphone*, and every screen that names one -- the
  // assignment screen, the mic-recovery overlay, the results -- spells it
  // through micLabel(). The lane once said "P3", from an older model where a
  // slot belonged to a player; a lane that disagrees with the screen the singer
  // just claimed their mic on is worse than one with no label at all.
  it('names the microphone in the same words as every other screen', () => {
    render(
      <LanePanel slotNumber={3} singerName="Mira">
        <div />
      </LanePanel>,
    )

    const badge = screen.getByTestId('lane-slot-badge')
    expect(badge).toHaveTextContent(micLabel(3))
    expect(badge.textContent).not.toMatch(/^P\d/)
  })

  // A lane is the busiest subtree on the screen -- a scrolling note strip, a
  // pitch line and a hit-burst layer, times up to eight stacked lanes. The
  // containment is what stops an invalidation inside one of them from walking
  // up and dirtying the other seven.
  it('contains its own layout, style and paint, so one lane can never dirty its siblings', () => {
    render(
      <LanePanel slotNumber={1} singerName="Alex">
        <div />
      </LanePanel>,
    )

    const contain = screen.getByTestId('lane-track').style.contain
    expect(contain).toContain('layout')
    expect(contain).toContain('paint')
    expect(contain).toContain('style')
  })
})
