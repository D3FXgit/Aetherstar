import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VuMeter } from '../VuMeter'

describe('VuMeter', () => {
  it('exposes the level as an accessible meter, not just a coloured div', () => {
    render(<VuMeter rms={1} label="P1 input level" />)

    const meter = screen.getByRole('meter', { name: 'P1 input level' })
    expect(meter).toHaveAttribute('aria-valuenow', '100')
  })

  it('reads empty for a silent input', () => {
    render(<VuMeter rms={0} label="P2 input level" />)

    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByTestId('vu-meter-fill')).toHaveStyle({ width: '0%' })
  })

  // Silence is an idle row's normal state, and an -Infinity dB value turns a
  // width into "NaN%", which breaks the bar permanently rather than visibly.
  it('never emits a NaN width', () => {
    render(<VuMeter rms={0} label="P3 input level" />)

    expect(screen.getByTestId('vu-meter-fill').getAttribute('style')).not.toContain('NaN')
  })

  it('gives a quiet signal a visible bar rather than an invisible sliver', () => {
    render(<VuMeter rms={0.01} label="P4 input level" />)

    const level = Number(screen.getByTestId('vu-meter').dataset.level)
    expect(level).toBeGreaterThan(0.2)
  })

  it('drops the peak marker under reduced motion but keeps metering', () => {
    render(<VuMeter rms={0.5} label="P5 input level" reducedMotion />)

    expect(screen.queryByTestId('vu-meter-peak')).not.toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '90')
  })

  it('shows a peak marker when motion is allowed', () => {
    render(<VuMeter rms={0.5} label="P6 input level" />)

    expect(screen.getByTestId('vu-meter-peak')).toBeInTheDocument()
  })
})
