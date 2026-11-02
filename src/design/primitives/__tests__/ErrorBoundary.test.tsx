import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'
import { useSceneStore } from '../../../scenes/sceneStore'
import { CRASH_PREFIX } from '../../../diagnostics/log'

function Boom({ message = 'render-phase boom' }: { message?: string }): never {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  // React itself logs the caught error; silenced so the assertions below read
  // only what the boundary deliberately reports.
  let errorSpy = vi.spyOn(console, 'error')

  beforeEach(() => {
    useSceneStore.setState({ current: 'session-play' })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary label="app-shell">
        <p>happy path</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('happy path')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
  })

  it('catches a render-phase throw and shows the GlassErrorState fallback instead of a white screen', () => {
    render(
      <ErrorBoundary label="scene:sing">
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    expect(screen.getByTestId('glass-error-state')).toBeInTheDocument()
    expect(screen.getByText(/render-phase boom/)).toBeInTheDocument()
  })

  it('logs the error and the React component stack under the greppable crash prefix', () => {
    render(
      <ErrorBoundary label="scene:sing">
        <Boom />
      </ErrorBoundary>,
    )

    const crashCall = errorSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes(CRASH_PREFIX),
    )
    expect(crashCall).toBeDefined()
    expect(crashCall![0]).toContain('scene:sing')
    expect(crashCall![0]).toContain('render-phase boom')

    const payload = crashCall![1] as { componentStack?: string }
    expect(typeof payload.componentStack).toBe('string')
    expect(payload.componentStack).toContain('Boom')
  })

  it('leads with plain-language copy and keeps the technical text behind "Show details"', () => {
    render(
      <ErrorBoundary label="scene:sing">
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    const details = screen.getByTestId('glass-error-details')
    expect(details.tagName).toBe('DETAILS')
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('Show details')
    expect(details).toHaveTextContent('Error: render-phase boom')
    expect(details).toHaveTextContent(CRASH_PREFIX)
  })

  it('offers a "Back to menu" way out that navigates via the scene store', async () => {
    render(
      <ErrorBoundary label="scene:sing">
        <Boom />
      </ErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back to menu' }))

    expect(useSceneStore.getState().current).toBe('home')
  })

  it('resets its caught error when resetKey changes, so recovering actually re-renders children', async () => {
    function Harness() {
      const [sceneKey, setSceneKey] = useState('sing')
      return (
        <>
          <button type="button" onClick={() => setSceneKey('home')}>
            change scene
          </button>
          <ErrorBoundary label={`scene:${sceneKey}`} resetKey={sceneKey}>
            {sceneKey === 'sing' ? <Boom /> : <p>recovered</p>}
          </ErrorBoundary>
        </>
      )
    }

    render(<Harness />)
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'change scene' }))

    expect(screen.getByText('recovered')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
  })
})
