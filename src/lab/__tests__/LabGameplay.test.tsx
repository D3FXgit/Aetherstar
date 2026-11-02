import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LabGameplay } from '../LabGameplay'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const chartRaw = readFileSync(path.join(ROOT, 'fixtures/sample-song/notes.txt'), 'utf-8')
const ABSOLUTE_FIXTURE_PATH = '/abs/fixtures/sample-song/notes.txt'

describe('LabGameplay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.api
  })

  it('replaying the "perfect" trace drives the real pipeline and displays a high score, mic-free', async () => {
    // @ts-expect-error -- only the members LabGameplay actually uses are stubbed
    window.api = { stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(chartRaw) }))

    render(<LabGameplay />)

    await waitFor(() => expect(screen.getByRole('button', { name: /perfect/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /perfect/i }))
    await userEvent.click(screen.getByRole('button', { name: /replay/i }))

    await waitFor(() => expect(screen.getByTestId('lab-gameplay-score')).toHaveTextContent('%'))
    const scoreText = screen.getByTestId('lab-gameplay-score').textContent ?? ''
    expect(Number(scoreText.replace(/[^0-9.]/g, ''))).toBeGreaterThan(0)
  })

  it('replaying the "silence" trace displays a near-zero score', async () => {
    // @ts-expect-error -- only the members LabGameplay actually uses are stubbed
    window.api = { stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(chartRaw) }))

    render(<LabGameplay />)

    await waitFor(() => expect(screen.getByRole('button', { name: /silence/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /silence/i }))
    await userEvent.click(screen.getByRole('button', { name: /replay/i }))

    await waitFor(() => expect(screen.getByTestId('lab-gameplay-score')).toHaveTextContent('0'))
  })
})
