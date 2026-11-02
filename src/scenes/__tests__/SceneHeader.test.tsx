import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackAuthorityProvider, BackButton, SceneHeader, SceneTitleBar } from '../SceneHeader'
import {
  SCENE_HEADER_HEIGHT_CLASS,
  SCENE_HEADER_INSET_CLASS,
  sceneHidesBackControl,
  sceneRendersOwnBack,
  sceneShowsBack,
  sceneShowsHeader,
} from '../sceneChrome'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

describe('BackButton', () => {
  // The control screens compose into their own header row. Everything the old
  // floating bar got right has to survive the move, so it is all asserted on
  // the button itself rather than on the bar that used to wrap it.

  it('runs the shell Back authority it was published, not a navigation of its own', async () => {
    const onBack = vi.fn()
    render(
      <BackAuthorityProvider onBack={onBack}>
        <BackButton />
      </BackAuthorityProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // The authority is phase-aware and raises the abandon prompt mid-song, so a
  // screen must never be able to substitute its own. The only way to press
  // this button is to run whatever the shell published.
  it('reads the authority from context, so every screen shares one Back', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <BackAuthorityProvider onBack={first}>
        <BackButton />
      </BackAuthorityProvider>,
    )

    rerender(
      <BackAuthorityProvider onBack={second}>
        <BackButton />
      </BackAuthorityProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  // Rendered outside the shell -- a unit test, a lab scene -- it must still
  // render rather than throwing, since a screen cannot know whether it is
  // mounted under the provider.
  it('is inert rather than broken with no shell above it', async () => {
    render(<BackButton />)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  // HIG Game controls: "Make sure frequently used controls are a minimum size
  // of 44x44 points". This is the most-pressed control in the app, read from a
  // sofa. h-14 = 3.5rem = 56px.
  it('is at least a 44pt hit target', () => {
    render(<BackButton />)

    expect(screen.getByRole('button', { name: 'Back' }).className).toContain('h-14')
  })

  // The spatial focus system in src/input/ walks focusable elements; a div with
  // an onClick is invisible to it, so gamepad and keyboard users would lose the
  // control entirely.
  it('is a real button, so the gamepad/keyboard focus system reaches it', () => {
    render(<BackButton />)

    expect(screen.getByRole('button', { name: 'Back' }).tagName).toBe('BUTTON')
  })

  // src/index.css draws the app's one focus treatment as an *outset* outline.
  // A `focus-visible:` of its own would compete with it, and any clipping
  // ancestor in this subtree would slice it off.
  it('states no focus treatment of its own and clips nothing', () => {
    render(<BackButton className="self-start" />)

    const button = screen.getByRole('button', { name: 'Back' })
    expect(button.className).not.toContain('focus-visible:')
    expect(button.className).not.toMatch(/overflow-(hidden|clip)/)
  })

  it('takes layout classes from the screen that composes it', () => {
    render(<BackButton className="pointer-events-auto" />)

    expect(screen.getByRole('button', { name: 'Back' }).className).toContain('pointer-events-auto')
  })
})

/**
 * The idiom the six converted screens share.
 *
 * One component so that six screens cannot end up with six subtly different
 * headers -- which is what "properly integrated across the board" has to mean
 * if it is to mean anything. Everything asserted here is a property the user
 * actually reported the absence of.
 */
describe('SceneTitleBar (the header screens compose)', () => {
  it('leads with Back, before the screen’s own title, in reading order', () => {
    render(<SceneTitleBar title="Mic Setup" />)

    const row = screen.getByTestId('scene-title-bar')
    const back = screen.getByRole('button', { name: 'Back' })
    const heading = screen.getByRole('heading', { name: 'Mic Setup' })

    expect(row).toContainElement(back)
    expect(row).toContainElement(heading)
    // HIG Layout: reading order runs "from the leading to trailing side".
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // The screen's title is the screen's title. A results screen that renders two
  // <h1>s, or a roster with none, is the same "two headers" bug in a new place.
  it('gives the screen exactly one top-level heading', () => {
    render(<SceneTitleBar title="Players" subtitle="Everyone who might sing tonight." />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  // The 4K failure, pinned. Every metric on this row is a multiple of `--u`,
  // floored by a `max()` against the fixed size it has everywhere else -- so it
  // can never be smaller than 44pt and never stay 1080p-sized on a television.
  it('sizes Back in design units with a hard 3.5rem floor under it', () => {
    render(<SceneTitleBar title="Library" />)

    const style = screen.getByRole('button', { name: 'Back' }).getAttribute('style') ?? ''
    expect(style).toContain('var(--u, 1px)')
    expect(style).toContain('3.5rem')
  })

  // The row itself must not clip: src/index.css draws focus as an *outset*
  // outline, and Back is the first thing a gamepad lands on.
  it('clips nothing, so the outset focus ring on Back survives', () => {
    render(<SceneTitleBar title="Calibration" />)

    expect(screen.getByTestId('scene-title-bar').className).not.toMatch(/overflow-(hidden|clip)/)
  })

  it('runs the shell’s Back authority, never a navigation of its own', async () => {
    const onBack = vi.fn()
    render(
      <BackAuthorityProvider onBack={onBack}>
        <SceneTitleBar title="Mic Check" />
      </BackAuthorityProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('carries an optional subtitle and the screen’s own trailing controls', () => {
    render(
      <SceneTitleBar
        title="Library"
        subtitle="Every song AetherStar has found."
        trailing={<button type="button">Add folder</button>}
      />,
    )

    expect(screen.getByText('Every song AetherStar has found.')).toBeInTheDocument()
    expect(screen.getByTestId('scene-title-bar')).toContainElement(screen.getByRole('button', { name: 'Add folder' }))
  })

  it('takes gutter classes from the screen that composes it', () => {
    render(<SceneTitleBar title="Library" className="px-6 pt-6" />)

    expect(screen.getByTestId('scene-title-bar').className).toContain('px-6')
  })
})

describe('SceneHeader (the fallback bar)', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
  })

  it.each(['home', 'boot'] as const)("shows nothing on '%s', which has no layer underneath it", (scene) => {
    render(<SceneHeader scene={scene} />)

    expect(screen.queryByTestId('scene-header')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  // The screens that keep the bar: the lab scenes, which have no header of
  // their own to put the control in. Deleting the bar outright would silently
  // strip the control from every one of them.
  it.each(['lab', 'lab-stage', 'lab-fx', 'lab-session', 'lab-multiplayer'] as const)(
    "still carries the Back control on '%s'",
    (scene) => {
      render(<SceneHeader scene={scene} />)

      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    },
  )

  // The Clean HUD change. A song owns the whole window, so the bar stands down
  // over it entirely -- Escape (or gamepad B) is the way out, and mid-song that
  // route asks before it throws the song away. Asserted here as well as in
  // sceneChrome.test.ts because this is the component that would actually draw
  // the pill over the lyrics.
  it.each(['session-starting', 'session-play'] as const)(
    "draws nothing over '%s', where the song is the screen",
    (scene) => {
      render(<SceneHeader scene={scene} />)

      expect(screen.queryByTestId('scene-header')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    },
  )

  // The regression this whole change exists for. These screens draw Back in
  // their own header row, so the bar must not also draw one above them -- two
  // Back buttons on one screen, and a reserved band pushing the screen's real
  // header 80px down, is exactly what the user reported three times.
  it.each([
    'session-select',
    'session-assign',
    'session-leaderboard',
    'settings',
    'players',
    'mic',
    'calibration',
    'hardware-setup',
    'session-results',
  ] as const)("stands down on '%s', which draws Back in its own header", (scene) => {
    render(<SceneHeader scene={scene} />)

    expect(screen.queryByTestId('scene-header')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  // A full-width 5rem strip across the top of a couch app would otherwise eat
  // every click and hover in it.
  it('lets clicks through the bar while keeping the button itself hittable', () => {
    render(<SceneHeader scene="lab" />)

    expect(screen.getByTestId('scene-header').className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Back' }).className).toContain('pointer-events-auto')
  })

  // The bar and the band SceneRouter reserves are the same 5rem by
  // construction; if they ever drift, the control overlaps the scene again.
  it('reserves exactly as much space as its own height', () => {
    render(<SceneHeader scene="lab" />)

    expect(SCENE_HEADER_HEIGHT_CLASS).toBe('h-20')
    expect(SCENE_HEADER_INSET_CLASS).toBe('pt-20')
    expect(screen.getByTestId('scene-header').className).toContain(SCENE_HEADER_HEIGHT_CLASS)
  })

  it('never clips its own subtree, so the global focus outline survives', () => {
    render(<SceneHeader scene="lab" />)

    expect(screen.getByTestId('scene-header').className).not.toMatch(/overflow-(hidden|clip)/)
  })

  it('collapses its own entrance to an instant cut under reduced motion', () => {
    mocks.reducedMotion = true

    render(<SceneHeader scene="lab" />)

    expect(screen.getByTestId('scene-header')).toHaveAttribute('data-reduced-motion', 'true')
  })

  it('routes the bar through the same authority the composed button uses', async () => {
    const onBack = vi.fn()
    render(
      <BackAuthorityProvider onBack={onBack}>
        <SceneHeader scene="lab" />
      </BackAuthorityProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('exposes the same rule as a predicate, so the scene frame reserves a matching band', () => {
    expect(sceneShowsHeader('home')).toBe(false)
    expect(sceneShowsHeader('boot')).toBe(false)
    expect(sceneShowsHeader('lab')).toBe(true)
    // Chromeless: Back is available (Escape/gamepad B), and nothing draws it --
    // so the frame reserves nothing above the song either.
    expect(sceneShowsHeader('session-starting')).toBe(false)
    expect(sceneShowsBack('session-starting')).toBe(true)
    expect(sceneHidesBackControl('session-starting')).toBe(true)
    expect(sceneShowsHeader('session-play')).toBe(false)
    expect(sceneShowsBack('session-play')).toBe(true)
    // Self-headed: Back is available, but the bar is not what draws it.
    expect(sceneShowsHeader('settings')).toBe(false)
    expect(sceneShowsBack('settings')).toBe(true)
    expect(sceneRendersOwnBack('settings')).toBe(true)
    expect(sceneShowsHeader('players')).toBe(false)
    expect(sceneShowsBack('players')).toBe(true)
    expect(sceneRendersOwnBack('players')).toBe(true)
  })
})
