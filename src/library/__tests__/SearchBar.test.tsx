import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from '../SearchBar'

describe('SearchBar', () => {
  it('calls onQueryChange with the typed query', async () => {
    const onQueryChange = vi.fn()
    render(<SearchBar onQueryChange={onQueryChange} resultCount={42} />)
    await userEvent.type(screen.getByRole('searchbox'), 'nova')
    expect(onQueryChange).toHaveBeenLastCalledWith('nova')
  })

  it('shows the result count in the placeholder text', () => {
    const onQueryChange = vi.fn()
    render(<SearchBar onQueryChange={onQueryChange} resultCount={42} />)
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search 42 songs by title, artist or edition')
  })

  // This is a gamepad-driven couch app whose only focus cue is the outline in
  // src/index.css. The field used to carry `outline-none`, which meant focus
  // could land on it and leave no visible trace at all from across a room --
  // there is no caret to see at that distance.
  it('does not opt out of the app-wide focus outline', () => {
    render(<SearchBar onQueryChange={vi.fn()} resultCount={42} />)
    expect(screen.getByRole('searchbox').className).not.toContain('outline-none')
  })

  // Screen readers announce the placeholder only as a hint, and it changes
  // with the result count; the field needs a stable name of its own.
  it('has a stable accessible name that does not drift with the result count', () => {
    render(<SearchBar onQueryChange={vi.fn()} resultCount={42} />)
    expect(screen.getByRole('searchbox', { name: 'Search songs' })).toBeInTheDocument()
  })
})
