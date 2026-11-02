import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { StageLab } from '../StageLab'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/sample-song/notes.txt',
)
const raw = readFileSync(FIXTURE_PATH, 'utf-8')
const ABSOLUTE_FIXTURE_PATH = '/abs/fixtures/sample-song/notes.txt'

describe('StageLab', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.api
  })

  it('picks a chart via window.api.openFile and plays it once loaded', async () => {
    // @ts-expect-error -- only the members StageLab.tsx actually uses are stubbed
    window.api = { openFile: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(raw).buffer) }))

    render(<StageLab />)

    await userEvent.click(screen.getByRole('button', { name: /load chart/i }))

    expect(window.api!.openFile).toHaveBeenCalled()
    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
  })

  it('toggles the sync overlay readout', async () => {
    // @ts-expect-error -- only the members StageLab.tsx actually uses are stubbed
    window.api = { openFile: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(raw).buffer) }))

    render(<StageLab />)
    await userEvent.click(screen.getByRole('button', { name: /load chart/i }))
    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))

    expect(screen.queryByTestId('stage-sync-overlay')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /sync overlay/i }))
    expect(screen.getByTestId('stage-sync-overlay')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /sync overlay/i }))
    expect(screen.queryByTestId('stage-sync-overlay')).not.toBeInTheDocument()
  })
})
