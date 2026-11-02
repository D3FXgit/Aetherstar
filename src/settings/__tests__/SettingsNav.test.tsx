import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsNav } from '../SettingsNav'

const SECTIONS = [
  { id: 'a', label: 'Audio & Mics' },
  { id: 'b', label: 'Graphics' },
]

describe('SettingsNav', () => {
  it('renders one tab per section inside a labelled tab list', () => {
    render(<SettingsNav sections={SECTIONS} activeId="a" onSelect={() => {}} />)

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Audio & Mics' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Graphics' })).toBeInTheDocument()
  })

  it('marks exactly one tab selected', () => {
    render(<SettingsNav sections={SECTIONS} activeId="b" onSelect={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Graphics' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Audio & Mics' })).toHaveAttribute('aria-selected', 'false')
  })

  it('points each tab at the pane it controls', () => {
    render(<SettingsNav sections={SECTIONS} activeId="a" onSelect={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Graphics' })).toHaveAttribute('aria-controls', 'b')
  })

  it('calls onSelect with the section id', () => {
    const onSelect = vi.fn()
    render(<SettingsNav sections={SECTIONS} activeId="a" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Graphics' }))

    expect(onSelect).toHaveBeenCalledWith('b')
  })

  /**
   * The couch constraint. The usual desktop tab pattern gives the tab list one
   * tab stop and moves between tabs with the arrow keys -- which would make
   * every tab but one unreachable by this app's spatial focus, the only input
   * most people here are holding.
   */
  it('leaves every tab individually focusable rather than adopting a roving tabindex', () => {
    render(<SettingsNav sections={SECTIONS} activeId="a" onSelect={() => {}} />)

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('tabindex', '-1')
    }
  })
})
