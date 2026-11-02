import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LabLibrary } from '../LabLibrary'
import { useLibraryStore } from '../../library/useLibraryStore'

describe('LabLibrary', () => {
  beforeEach(() => {
    window.api = {
      openFile: vi.fn().mockResolvedValue('/picked/library'),
      library: {
        addRoot: vi.fn().mockResolvedValue(undefined),
        removeRoot: vi.fn().mockResolvedValue(undefined),
        listRoots: vi.fn().mockResolvedValue([]),
        rescan: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        getSong: vi.fn().mockResolvedValue(null),
        listScanErrors: vi.fn().mockResolvedValue([]),
        onScanProgress: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
    useLibraryStore.setState({ roots: [], results: [], scanProgress: {}, scanErrors: [], filters: {} })
  })

  it('picking a folder and scanning calls addRoot, independent of LibraryScene', async () => {
    render(<LabLibrary />)
    await userEvent.click(screen.getByRole('button', { name: /pick folder/i }))
    await waitFor(() => expect(window.api!.library.addRoot).toHaveBeenCalledWith('/picked/library'))
  })

  it('renders live songsFound/songsParsed/error counts from scanProgress', () => {
    useLibraryStore.setState({
      scanProgress: { '/library': { rootPath: '/library', songsFound: 12, songsParsed: 7, currentPath: null, done: false, errorCount: 2 } },
      scanErrors: [
        { path: '/library/a', reason: 'x', timestamp: 1 },
        { path: '/library/b', reason: 'y', timestamp: 2 },
      ],
    })
    render(<LabLibrary />)
    expect(screen.getByTestId('lab-library-progress')).toHaveTextContent('7 / 12')
    expect(screen.getByTestId('lab-library-error-count')).toHaveTextContent('2')
  })
})
