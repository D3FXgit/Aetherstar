import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MicRecoveryOverlay } from '../MicRecoveryOverlay'
import { useMicRecoveryStore, type LostInput } from '../micRecoveryStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { useSessionStore } from '../../session/sessionStore'
import { setLanguage } from '../../i18n'

const P1_LOST: LostInput = {
  captureKey: 'mic-1',
  deviceId: 'mic-1',
  channelIndex: 0,
  deviceName: 'USB Mic',
  micNumber: 1,
  playerName: 'Ada',
}

const P2_LOST: LostInput = {
  captureKey: 'mic-2#1',
  deviceId: 'mic-2',
  channelIndex: 1,
  deviceName: 'Scarlett 2i2',
  micNumber: 2,
  playerName: 'Grace',
}

function setLost(lostInputs: LostInput[], dismissed = false) {
  useMicRecoveryStore.setState({ lostInputs, dismissed })
}

describe('MicRecoveryOverlay', () => {
  beforeEach(() => {
    useMicRecoveryStore.setState({ lostInputs: [], dismissed: false, knownDeviceNames: {} })
    useSceneStore.setState({ current: 'home', history: [] })
    useSessionStore.setState({ phase: 'idle' })
  })

  it('renders nothing while every bound mic is connected', () => {
    render(<MicRecoveryOverlay />)
    expect(screen.queryByTestId('mic-recovery')).toBeNull()
  })

  it('renders nothing once the loss has been dismissed', () => {
    setLost([P1_LOST], true)
    render(<MicRecoveryOverlay />)
    expect(screen.queryByTestId('mic-recovery')).toBeNull()
  })

  describe('content', () => {
    beforeEach(() => setLost([P1_LOST]))

    it('leads with the seat number, not the device id', () => {
      render(<MicRecoveryOverlay />)
      expect(screen.getByTestId('mic-recovery')).toHaveTextContent('Mic 1')
      expect(screen.getByTestId('mic-recovery')).not.toHaveTextContent('mic-1')
    })

    it('names the player and the hardware so the right cable gets checked', () => {
      render(<MicRecoveryOverlay />)
      const overlay = screen.getByTestId('mic-recovery')
      expect(overlay).toHaveTextContent('Ada')
      expect(overlay).toHaveTextContent('USB Mic')
    })

    it('says what to do about it, not just that it happened', () => {
      render(<MicRecoveryOverlay />)
      expect(screen.getByTestId('mic-recovery-guidance')).toHaveTextContent(/same port/i)
    })

    it('offers continuing without that player, named by seat', () => {
      render(<MicRecoveryOverlay />)
      expect(screen.getByRole('button', { name: /continue without Mic 1/i })).toBeInTheDocument()
    })
  })

  it('names the mic in the title, and counts several', () => {
    setLost([P1_LOST])
    const { unmount } = render(<MicRecoveryOverlay />)
    expect(screen.getByRole('heading', { name: 'Mic 1 was unplugged' })).toBeInTheDocument()
    unmount()

    setLost([P1_LOST, P2_LOST])
    render(<MicRecoveryOverlay />)
    expect(screen.getByRole('heading', { name: '2 mics were unplugged' })).toBeInTheDocument()
  })

  describe('in German', () => {
    afterEach(async () => {
      await setLanguage(null)
    })

    it('fills the mic name and the count into the translated text', async () => {
      await act(() => setLanguage('de'))
      setLost([P1_LOST, P2_LOST])
      render(<MicRecoveryOverlay />)

      expect(screen.getByRole('heading', { name: '2 Mikros wurden ausgesteckt' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ohne sie weiter' })).toBeInTheDocument()
    })

    // The store keeps the mic's number, not a label, so the name follows the language.
    it('names the mic in the current language', async () => {
      await act(() => setLanguage('de'))
      setLost([P1_LOST])
      render(<MicRecoveryOverlay />)

      expect(screen.getByRole('heading', { name: 'Mikro 1 wurde ausgesteckt' })).toBeInTheDocument()
    })
  })

  it('lists every lost seat when several go down at once', () => {
    setLost([P1_LOST, P2_LOST])
    render(<MicRecoveryOverlay />)

    expect(screen.getByTestId('mic-recovery-lost-mic-1')).toHaveTextContent('Ada')
    expect(screen.getByTestId('mic-recovery-lost-mic-2#1')).toHaveTextContent('Grace')
    expect(screen.getByRole('button', { name: /continue without them/i })).toBeInTheDocument()
  })

  it('dismisses on the continue-without action', () => {
    setLost([P1_LOST])
    render(<MicRecoveryOverlay />)

    fireEvent.click(screen.getByRole('button', { name: /continue without Mic 1/i }))

    expect(useMicRecoveryStore.getState().dismissed).toBe(true)
  })

  describe('outside a song', () => {
    beforeEach(() => {
      useSceneStore.setState({ current: 'home', history: [] })
      setLost([P1_LOST])
    })

    it('is a modal alert that confines gamepad focus to itself', () => {
      render(<MicRecoveryOverlay />)
      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('data-focus-scope')
    })

    it('takes focus so a controller lands on the safe choice, not the screen behind', () => {
      render(<MicRecoveryOverlay />)
      expect(screen.getByRole('button', { name: /continue without Mic 1/i })).toHaveFocus()
    })

    it('offers re-pointing the microphone in Mic Setup', () => {
      render(<MicRecoveryOverlay />)
      fireEvent.click(screen.getByRole('button', { name: /mic setup/i }))
      expect(useSceneStore.getState().current).toBe('hardware-setup')
    })

    it('dismisses on Escape without letting the shell Back handler also fire', () => {
      const shellBack = vi.fn()
      window.addEventListener('keydown', shellBack)
      render(<MicRecoveryOverlay />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(useMicRecoveryStore.getState().dismissed).toBe(true)
      expect(shellBack).not.toHaveBeenCalled()
      window.removeEventListener('keydown', shellBack)
    })
  })

  describe('mid-song', () => {
    beforeEach(() => {
      useSceneStore.setState({ current: 'session-play', history: [] })
      useSessionStore.setState({ phase: 'play' })
      setLost([P1_LOST])
    })

    it('is a non-modal banner: the other singers keep playing', () => {
      render(<MicRecoveryOverlay />)
      // No alertdialog, no focus scope -- a modal here would freeze the song
      // for seven people because one person's cable moved.
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.getByTestId('mic-recovery')).not.toHaveAttribute('data-focus-scope')
    })

    it('announces itself without stealing focus from gameplay', () => {
      render(<MicRecoveryOverlay />)
      expect(screen.getByTestId('mic-recovery')).toHaveAttribute('role', 'alert')
      expect(screen.getByRole('button', { name: /continue without Mic 1/i })).not.toHaveFocus()
    })

    it('leaves the session phase exactly where it was', () => {
      render(<MicRecoveryOverlay />)
      fireEvent.click(screen.getByRole('button', { name: /continue without Mic 1/i }))

      expect(useSessionStore.getState().phase).toBe('play')
      expect(useSceneStore.getState().current).toBe('session-play')
    })

    it('does not answer Escape, so Back still reaches the abandon-song prompt', () => {
      const shellBack = vi.fn()
      window.addEventListener('keydown', shellBack)
      render(<MicRecoveryOverlay />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(shellBack).toHaveBeenCalled()
      expect(useMicRecoveryStore.getState().dismissed).toBe(false)
      window.removeEventListener('keydown', shellBack)
    })

    it('does not offer leaving for Mic Setup mid-song', () => {
      render(<MicRecoveryOverlay />)
      expect(screen.queryByRole('button', { name: /mic setup/i })).toBeNull()
    })
  })
})
