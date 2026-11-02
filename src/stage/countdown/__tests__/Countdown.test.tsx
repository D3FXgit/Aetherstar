import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Countdown } from '../Countdown'
import { countdownSecondsAt, firstNoteMs } from '../secondsUntilGap'

describe('Countdown', () => {
  it('shows the number it is given while counting down', () => {
    render(<Countdown status="countdown" seconds={3} />)
    expect(screen.getByTestId('stage-countdown')).toHaveTextContent('3')
  })

  it('renders nothing once playback has started', () => {
    render(<Countdown status="playing" seconds={1} />)
    expect(screen.queryByTestId('stage-countdown')).not.toBeInTheDocument()
  })

  it('renders nothing outside the lead-in', () => {
    render(<Countdown status="countdown" seconds={null} />)
    expect(screen.queryByTestId('stage-countdown')).not.toBeInTheDocument()
  })

  it('is a solid chip, never a backdrop blur over the video', () => {
    render(<Countdown status="countdown" seconds={2} />)
    expect(screen.getByTestId('stage-countdown').className).not.toMatch(/backdrop-blur/)
  })
})

describe('the lead-in', () => {
  it('counts only the last three seconds before the first note', () => {
    expect(countdownSecondsAt(0, 24065)).toBeNull()
    expect(countdownSecondsAt(21065, 24065)).toBe(3)
    expect(countdownSecondsAt(22100, 24065)).toBe(2)
    expect(countdownSecondsAt(23500, 24065)).toBe(1)
    expect(countdownSecondsAt(24065, 24065)).toBeNull()
  })

  it('counts down to the first note, not to #GAP', () => {
    const chart = {
      meta: { artist: '', title: '', mp3Path: '', bpm: 120, gap: 1000, videoGap: 0 },
      lines: [{ part: 'solo' as const, notes: [{ kind: 'normal' as const, startBeat: 16, length: 2, pitch: 60, syllable: 'a' }] }],
    }
    // 16 quarter-beats at 120 BPM = 2000 ms after the 1000 ms gap.
    expect(firstNoteMs(chart)).toBe(3000)
    expect(firstNoteMs({ ...chart, lines: [] })).toBe(1000)
  })
})
