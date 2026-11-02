import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsRow, SettingsLinkRow } from '../SettingsRow'

describe('SettingsRow', () => {
  it('renders the label, the optional description, and the trailing control', () => {
    render(
      <SettingsRow label="Reduce effects" description="Fewer particles.">
        <button type="button">Toggle</button>
      </SettingsRow>,
    )

    expect(screen.getByText('Reduce effects')).toBeInTheDocument()
    expect(screen.getByText('Fewer particles.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument()
  })

  it('omits the description line when none is given', () => {
    render(<SettingsRow label="Output offset" />)
    expect(screen.getByText('Output offset')).toBeInTheDocument()
  })

  it('is not itself a button -- a value row must not read as navigational', () => {
    render(<SettingsRow label="Output offset" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('SettingsLinkRow', () => {
  it('is a single whole-row button named by its action', () => {
    render(<SettingsLinkRow label="Roster" description="2 players." action="Manage players" onClick={() => {}} />)

    const row = screen.getByRole('button', { name: 'Manage players' })
    expect(row).toBeInTheDocument()
    expect(screen.getByText('Roster')).toBeInTheDocument()
    expect(screen.getByText('2 players.')).toBeInTheDocument()
  })

  it('fires onClick when the row is activated', () => {
    const onClick = vi.fn()
    render(<SettingsLinkRow label="Roster" action="Manage players" onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Manage players' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows a disclosure chevron, so it is visibly distinct from a value row', () => {
    const { container } = render(<SettingsLinkRow label="Roster" action="Manage players" onClick={() => {}} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
