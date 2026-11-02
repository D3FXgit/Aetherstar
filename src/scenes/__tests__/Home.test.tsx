import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Home } from '../Home'
import { useSceneStore } from '../sceneStore'
import { useSessionStore } from '../../session/sessionStore'
import { usePitchStore } from '../../audio/pitchStore'
import { useMenuMusicStore } from '../../audio/menuMusic'

describe('Home', () => {
  afterEach(() => {
    delete window.api
  })

  beforeEach(() => {
    useSceneStore.setState({ current: 'home' })
    window.api = {
      session: { start: vi.fn().mockResolvedValue({ id: 's1', startedAt: 1 }), recordEntry: vi.fn(), listLeaderboard: vi.fn() },
      getAppInfo: vi.fn().mockResolvedValue({ platform: 'darwin' }),
      onPong: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window['api']
  })

  it('renders exactly three buttons: Start a night, Jukebox, Settings', () => {
    render(<Home />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Start a night', 'Jukebox', 'Settings'])
  })

  // The menu is the same under Electron and in the browser preview: no version
  // dump, no developer panels.
  it('renders no developer panels under Electron', () => {
    render(<Home />)

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByText(/vd+.d+.d+/)).not.toBeInTheDocument()
  })

  // One filled call to action; the rest are solid secondary buttons.
  it('makes "Start a night" the only primary button', () => {
    render(<Home />)
    expect(screen.getByRole('button', { name: 'Start a night' })).toHaveAttribute('data-variant', 'primary')
    expect(screen.getByRole('button', { name: 'Jukebox' })).toHaveAttribute('data-variant', 'solid')
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('data-variant', 'solid')
  })

  it('shows Exit last when the app can quit, and quits on click', async () => {
    const quit = vi.fn()
    window.api = { ...window.api, quit } as unknown as Window['api']
    render(<Home />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Start a night', 'Jukebox', 'Settings', 'Exit'])
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(quit).toHaveBeenCalledTimes(1)
  })

  // Gamepad focus walks the DOM in order, so the middle button must sit between the other two.
  it('puts Jukebox between Start a night and Settings', () => {
    render(<Home />)
    const [start, jukebox, settings] = screen.getAllByRole('button')
    expect(start.compareDocumentPosition(jukebox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(jukebox.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('starts the jukebox through the session store', async () => {
    const original = useSessionStore.getState().startJukebox
    const startJukebox = vi.fn().mockResolvedValue(undefined)
    useSessionStore.setState({ startJukebox })
    try {
      render(<Home />)
      await userEvent.click(screen.getByRole('button', { name: 'Jukebox' }))
      expect(startJukebox).toHaveBeenCalledOnce()
    } finally {
      useSessionStore.setState({ startJukebox: original })
    }
  })

  // Sentence case, a plain count, and no audio driver name.
  it('shows a player-friendly mic readout without the audio backend', () => {
    usePitchStore.setState({ devices: [] })
    const { unmount } = render(<Home />)
    expect(screen.getByTestId('home-status')).toHaveTextContent('No mic found')
    unmount()

    usePitchStore.setState({
      devices: [
        { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 },
        { id: 'mic-2', name: 'Interface In 1', channelCount: 1, sampleRate: 48000 },
      ],
    })
    render(<Home />)
    expect(screen.getByTestId('home-status')).toHaveTextContent('2 mics ready')
    expect(screen.getByTestId('home-status').textContent).not.toMatch(/WASAPI|CORE AUDIO|ALSA/)
    usePitchStore.setState({ devices: [] })
  })

  it('starts the session and goes straight to song selection when "Start a night" is clicked', async () => {
    render(<Home />)
    await userEvent.click(screen.getByRole('button', { name: 'Start a night' }))
    await waitFor(() => expect(useSceneStore.getState().current).toBe('session-select'))
  })

  it('navigates to the settings scene when "Settings" is clicked', async () => {
    render(<Home />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(useSceneStore.getState().current).toBe('settings')
  })
  describe('now playing', () => {
    afterEach(() => {
      useMenuMusicStore.setState({ nowPlaying: null, source: null })
    })

    it('names the library song playing behind the menu, under the mic status', () => {
      useMenuMusicStore.setState({ nowPlaying: { title: 'Africa', artist: 'Toto' }, source: 'library' })
      render(<Home />)

      const line = screen.getByTestId('home-now-playing')
      expect(line).toHaveTextContent('Now playing: Africa – Toto')
      expect(line).toHaveClass('text-ink-tertiary')
      // Directly after the mic status line.
      expect(screen.getByTestId('home-status').nextElementSibling).toBe(line)
    })

    it('says nothing for the built-in loop or silence', () => {
      useMenuMusicStore.setState({ nowPlaying: null, source: 'builtin' })
      render(<Home />)
      expect(screen.queryByTestId('home-now-playing')).not.toBeInTheDocument()
    })
  })
})
