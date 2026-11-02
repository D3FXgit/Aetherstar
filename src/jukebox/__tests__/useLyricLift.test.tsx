import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LYRIC_CLEARANCE_PX, LYRIC_LIFT_VAR, lyricLiftPx, lyricLiftStyle, useLyricLift } from '../useLyricLift'

describe('lyricLiftPx', () => {
  it('lifts the lyrics just clear of the bar, and not at all when they already clear it', () => {
    // 1080 tall, bar 200 tall (top at 880), lyrics ending at 950: 70 px of overlap + clearance.
    expect(lyricLiftPx({ lyricsBottom: 950, sceneHeight: 1080, transportHeight: 200 })).toBe(70 + LYRIC_CLEARANCE_PX)
    expect(lyricLiftPx({ lyricsBottom: 700, sceneHeight: 1080, transportHeight: 200 })).toBe(0)
  })

  it('holds at a small window and at 4K alike', () => {
    expect(lyricLiftPx({ lyricsBottom: 600, sceneHeight: 640, transportHeight: 150 })).toBe(600 + LYRIC_CLEARANCE_PX - 490)
    expect(lyricLiftPx({ lyricsBottom: 1900, sceneHeight: 2160, transportHeight: 400 })).toBe(1900 + LYRIC_CLEARANCE_PX - 1760)
  })

  it('animates the lift unless motion is reduced', () => {
    expect(lyricLiftStyle(false)).toMatchObject({ translate: `0 calc(-1 * var(${LYRIC_LIFT_VAR}, 0px))` })
    expect(lyricLiftStyle(false).transition).toMatch(/translate/)
    expect(lyricLiftStyle(true).transition).toBeUndefined()
  })
})

/** Gives an element the offset geometry jsdom does not compute. */
function place(element: HTMLElement, top: number, height: number, parent: HTMLElement | null) {
  Object.defineProperty(element, 'offsetTop', { configurable: true, value: top })
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height })
  Object.defineProperty(element, 'offsetParent', { configurable: true, value: parent })
}

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLyricLift(ref, active)
  return (
    <div ref={ref} data-testid="scene">
      <div data-testid="grid">
        <div data-testid="lyric-box" />
      </div>
      <div data-testid="jukebox-transport" />
    </div>
  )
}

describe('useLyricLift', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('publishes the measured lift while the bar is up, and 0 once it hides', () => {
    // Geometry has to exist before the effect measures, so it is stubbed on the prototype first.
    const sceneHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1080)
    const { getByTestId, rerender } = render(<Harness active={false} />)
    const scene = getByTestId('scene')
    place(getByTestId('grid'), 0, 1080, scene)
    place(getByTestId('lyric-box'), 800, 150, getByTestId('grid'))
    place(getByTestId('jukebox-transport'), 880, 200, scene)
    expect(scene.style.getPropertyValue(LYRIC_LIFT_VAR)).toBe('0px')

    rerender(<Harness active />)
    // Lyrics end at 950, the bar starts at 880.
    expect(scene.style.getPropertyValue(LYRIC_LIFT_VAR)).toBe(`${70 + LYRIC_CLEARANCE_PX}px`)

    rerender(<Harness active={false} />)
    expect(scene.style.getPropertyValue(LYRIC_LIFT_VAR)).toBe('0px')
    sceneHeight.mockRestore()
  })
})
