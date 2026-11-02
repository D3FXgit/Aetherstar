import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LibrarySearchFilters } from '../../../library/types'
import { SongGrid } from '../SongGrid'

const noop = vi.fn()

function renderGrid(filters: LibrarySearchFilters, resetKey: unknown) {
  return (
    <SongGrid
      songs={[]}
      selectedPath={null}
      favorites={new Set()}
      resetKey={resetKey}
      filters={filters}
      onSelect={noop}
      onQuickStart={noop}
      onHover={noop}
    />
  )
}

describe('SongGrid', () => {
  // Regression: an empty result list used to ask react-window to scroll to row
  // 0, which throws "Invalid index specified: 0" and crashed song select.
  it('does not crash when the list is empty and the filters change', () => {
    const { rerender } = render(renderGrid({} as LibrarySearchFilters, 'a'))
    expect(() => rerender(renderGrid({ query: 'nothing' } as LibrarySearchFilters, 'b'))).not.toThrow()
  })
})
