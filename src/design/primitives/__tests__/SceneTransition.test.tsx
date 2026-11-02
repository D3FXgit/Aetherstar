import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SceneTransition } from '../SceneTransition'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

describe('SceneTransition', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
  })

  it('renders its children', () => {
    render(
      <SceneTransition sceneKey="home">
        <div>Scene content</div>
      </SceneTransition>,
    )

    expect(screen.getByText('Scene content')).toBeInTheDocument()
  })

  // The reported "layout stacking" bug in one assertion: if both scenes were
  // ever mounted together, two full-bleed surfaces would be in normal flow at
  // once and the shell would grow to hold both. `mode="wait"` is what makes
  // that impossible, and this is the regression that would catch its removal
  // (or a switch to the default "sync"/"popLayout" mode).
  it('never has two scenes mounted at once -- the outgoing one leaves before the incoming one arrives', async () => {
    const { rerender } = render(
      <SceneTransition sceneKey="settings">
        <div>Settings screen</div>
      </SceneTransition>,
    )

    rerender(
      <SceneTransition sceneKey="home">
        <div>Home screen</div>
      </SceneTransition>,
    )

    // Immediately after the key changes the old screen is still on its way out
    // and the new one has not been mounted yet.
    expect(screen.getByText('Settings screen')).toBeInTheDocument()
    expect(screen.queryByText('Home screen')).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('Home screen')).toBeInTheDocument())
    expect(screen.queryByText('Settings screen')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('scene-transition')).toHaveLength(1)
  })

  // Was: nothing. The component ignored the setting entirely, so every
  // navigation cross-faded and slid a full-screen surface for someone who had
  // asked the system for none of that.
  it('collapses to an instant cut when the viewer has asked for reduced motion', () => {
    mocks.reducedMotion = true

    render(
      <SceneTransition sceneKey="home">
        <div>Scene content</div>
      </SceneTransition>,
    )

    expect(screen.getByTestId('scene-transition')).toHaveAttribute('data-reduced-motion', 'true')
  })

  it('animates normally when the viewer has not asked for reduced motion', () => {
    render(
      <SceneTransition sceneKey="home">
        <div>Scene content</div>
      </SceneTransition>,
    )

    expect(screen.getByTestId('scene-transition')).toHaveAttribute('data-reduced-motion', 'false')
  })

  // This element is the scene's real parent, so it has to pass the shell's
  // flex context through rather than swallow it. As a plain block it broke
  // every screen that centres with `m-auto` (pinned to the top of the window
  // instead of centred), every screen that grows with `flex-1` (no effect in a
  // block parent), and every screen sized with `h-full` (a percentage of an
  // auto-height parent, which collapses to `auto`).
  it('is a full-width, growing flex column so scenes can centre and stretch inside it', () => {
    render(
      <SceneTransition sceneKey="home">
        <div>Scene content</div>
      </SceneTransition>,
    )

    const frame = screen.getByTestId('scene-transition')
    expect(frame.className).toContain('flex')
    expect(frame.className).toContain('flex-col')
    expect(frame.className).toContain('flex-1')
    expect(frame.className).toContain('w-full')
  })
})
