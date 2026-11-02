import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SettingsLibraryPanel } from '../SettingsLibraryPanel'

afterEach(() => {
  delete window.api
})

describe('SettingsLibraryPanel', () => {
  it('lists roots from library api.listRoots on mount', async () => {
    // @ts-expect-error -- only the members this panel touches are stubbed
    window.api = {
      library: { listRoots: vi.fn().mockResolvedValue([{ path: '/Music/UltraStar', addedAt: 1 }]) },
      openFile: vi.fn(),
    } as Window['api']

    render(<SettingsLibraryPanel />)
    await waitFor(() => expect(screen.getByText('/Music/UltraStar')).toBeInTheDocument())
  })

  it('picking a folder via AddLibraryFolderButton calls addRoot', async () => {
    const addRoot = vi.fn().mockResolvedValue(undefined)
    // @ts-expect-error -- only the members this panel touches are stubbed
    window.api = {
      library: { listRoots: vi.fn().mockResolvedValue([]), addRoot },
      openFile: vi.fn().mockResolvedValue('/Music/NewRoot'),
    } as Window['api']

    render(<SettingsLibraryPanel />)
    fireEvent.click(screen.getByRole('button', { name: /add.*folder/i }))

    await waitFor(() => expect(addRoot).toHaveBeenCalledWith('/Music/NewRoot'))
  })

  it('Remove and Rescan actions call removeRoot/rescan', async () => {
    const removeRoot = vi.fn().mockResolvedValue(undefined)
    const rescan = vi.fn().mockResolvedValue(undefined)
    // @ts-expect-error -- only the members this panel touches are stubbed
    window.api = {
      library: { listRoots: vi.fn().mockResolvedValue([{ path: '/Music/UltraStar', addedAt: 1 }]), removeRoot, rescan },
      openFile: vi.fn(),
    } as Window['api']

    render(<SettingsLibraryPanel />)
    await waitFor(() => expect(screen.getByText('/Music/UltraStar')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    expect(rescan).toHaveBeenCalledWith('/Music/UltraStar')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(removeRoot).toHaveBeenCalledWith('/Music/UltraStar')
  })
})
