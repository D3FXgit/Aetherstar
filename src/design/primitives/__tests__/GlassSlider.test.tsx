import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlassSlider } from '../GlassSlider'

describe('GlassSlider', () => {
  /**
   * The load-bearing assertion. This is a couch app: the spatial focus system
   * in src/input/ walks standard focusable elements, and the app's single
   * focus treatment is an `outline` on whatever the browser focuses. A custom
   * div with a drag handler would look identical and be unreachable from the
   * gamepad, so the control being a real range input is the requirement, not
   * an implementation detail.
   */
  it('is a real <input type="range">, so the pad and the focus ring can find it', () => {
    render(<GlassSlider label="Microphone level" value={0.5} onChange={() => {}} />)

    const slider = screen.getByRole('slider', { name: 'Microphone level' })
    expect(slider.tagName).toBe('INPUT')
    expect(slider).toHaveAttribute('type', 'range')
  })

  it('reports its value and range to assistive tech', () => {
    render(<GlassSlider label="Microphone level" value={0.4} min={0} max={1} onChange={() => {}} />)

    const slider = screen.getByRole('slider', { name: 'Microphone level' })
    expect(slider).toHaveValue('0.4')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '1')
  })

  it('calls onChange with a number, not a string', () => {
    const onChange = vi.fn()
    render(<GlassSlider label="Microphone level" value={0.5} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Microphone level' }), { target: { value: '0.75' } })
    expect(onChange).toHaveBeenCalledWith(0.75)
  })

  /**
   * Focusable, with a step the browser can arrow through.
   *
   * The arrow-key *movement* itself is deliberately not asserted: jsdom does
   * not implement range-input keyboard stepping, so a test of it would pass or
   * fail on the harness rather than on this component. What this component is
   * responsible for is being a focusable native range with a step -- Chromium
   * supplies the stepping, and src/input/ reaches it because it is focusable.
   */
  it('is focusable, with a step for the browser to arrow through', async () => {
    render(<GlassSlider label="Microphone level" value={0.5} step={0.05} onChange={() => {}} />)

    await userEvent.tab()
    const slider = screen.getByRole('slider', { name: 'Microphone level' })
    expect(slider).toHaveFocus()
    expect(slider).toHaveAttribute('step', '0.05')
  })

  it('disables the real control rather than only dimming it', async () => {
    const onChange = vi.fn()
    render(<GlassSlider label="Microphone level" value={0.5} onChange={onChange} disabled />)

    const slider = screen.getByRole('slider', { name: 'Microphone level' })
    expect(slider).toBeDisabled()

    await userEvent.click(slider)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards extra input props (e.g. data-testid) to the underlying input', () => {
    render(<GlassSlider label="Microphone level" value={0.2} onChange={() => {}} data-testid="my-slider" />)
    expect(screen.getByTestId('my-slider')).toHaveValue('0.2')
  })

  it('renders the optional value text beside the track, hidden from assistive tech', () => {
    render(<GlassSlider label="Microphone level" value={0.4} onChange={() => {}} valueText="40%" />)

    const text = screen.getByText('40%')
    // The input already exposes the value via `aria-valuenow`; a second
    // announcement of the same number is noise.
    expect(text).toHaveAttribute('aria-hidden', 'true')
  })

  /**
   * The whole control has to be a 44px target on the Settings screen, even
   * though the painted track is 6px -- a 6px-tall input is unhittable with a
   * pointer and invisible from a sofa.
   */
  it('gives the input the row-wide 44px hit target rather than the track height', () => {
    render(<GlassSlider label="Microphone level" value={0.5} onChange={() => {}} />)
    expect(screen.getByRole('slider', { name: 'Microphone level' }).className).toContain('h-11')
  })

  /**
   * The app's focus treatment is defined once, in src/index.css, for
   * `:focus-visible` and for directional nav mode. A component that added its
   * own `focus-visible:` utility would quietly diverge from it.
   */
  it('adds no focus treatment of its own', () => {
    render(<GlassSlider label="Microphone level" value={0.5} onChange={() => {}} />)
    expect(screen.getByRole('slider', { name: 'Microphone level' }).className).not.toContain('focus-visible:')
  })

  it('paints the fill up to the current fraction of the range', () => {
    const { rerender } = render(<GlassSlider label="Microphone level" value={0.25} onChange={() => {}} />)
    const slider = screen.getByRole('slider', { name: 'Microphone level' })
    expect(slider.style.getPropertyValue('--gs-track-background')).toContain('25%')

    rerender(<GlassSlider label="Microphone level" value={0.8} onChange={() => {}} />)
    expect(slider.style.getPropertyValue('--gs-track-background')).toContain('80%')
  })

  it('clamps the painted fill for an out-of-range value rather than overflowing the track', () => {
    render(<GlassSlider label="Microphone level" value={9} min={0} max={1} onChange={() => {}} />)
    expect(screen.getByRole('slider', { name: 'Microphone level' }).style.getPropertyValue('--gs-track-background')).toContain(
      '100%',
    )
  })

  it('does not divide by zero on a degenerate range', () => {
    expect(() =>
      render(<GlassSlider label="Microphone level" value={1} min={1} max={1} onChange={() => {}} />),
    ).not.toThrow()
  })
})
