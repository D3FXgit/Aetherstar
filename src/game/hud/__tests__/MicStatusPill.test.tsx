import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { setLanguage } from '../../../i18n'
import { MicStatusPill } from '../MicStatusPill'
import { usePitchStore } from '../../../audio/pitchStore'

const CAPTURE = { latest: null, samples: [], latencyMs: null }

describe('MicStatusPill', () => {
  beforeEach(() => {
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
  })

  afterEach(async () => {
    await setLanguage(null)
  })

  it('counts the live captures', () => {
    usePitchStore.setState({ activeCaptures: { 'dev-1': CAPTURE, 'dev-2': CAPTURE } })
    render(<MicStatusPill />)
    expect(screen.getByTestId('mic-status-pill')).toHaveTextContent('2 mics live')
  })

  it('says mic, singular, for one capture', () => {
    usePitchStore.setState({ activeCaptures: { 'dev-1': CAPTURE } })
    render(<MicStatusPill />)
    expect(screen.getByTestId('mic-status-pill')).toHaveTextContent('1 mic live')
  })

  it('speaks German when the language is German', async () => {
    usePitchStore.setState({ activeCaptures: { 'dev-1': CAPTURE, 'dev-2': CAPTURE } })
    await act(() => setLanguage('de'))
    render(<MicStatusPill />)
    expect(screen.getByTestId('mic-status-pill')).toHaveTextContent('2 Mikros aktiv')
  })

  // Nothing in this app measures end-to-end latency, so no latency figure is
  // shown at all rather than a plausible-looking invention.
  it('shows no latency figure, because none is measured', () => {
    usePitchStore.setState({ activeCaptures: { 'dev-1': CAPTURE } })
    render(<MicStatusPill />)
    expect(screen.getByTestId('mic-status-pill').textContent).not.toMatch(/ms/)
  })

  it('renders nothing when no mic is live', () => {
    render(<MicStatusPill />)
    expect(screen.queryByTestId('mic-status-pill')).not.toBeInTheDocument()
  })

  // Small, but it sits over playing video for the whole song like everything
  // else on this screen: a backdrop blur there re-filters the video every
  // frame. A solid translucent fill carries the separation instead.
  it('uses no backdrop filter over the video', () => {
    usePitchStore.setState({ activeCaptures: { 'dev-1': CAPTURE } })
    render(<MicStatusPill />)

    const className = screen.getByTestId('mic-status-pill').className
    expect(className).not.toMatch(/backdrop-/)
    expect(className).toMatch(/bg-black\//)
  })
})
