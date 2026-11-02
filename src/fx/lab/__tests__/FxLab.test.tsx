import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useImperativeHandle } from 'react'
import { FxLab } from '../FxLab'
import { useFxSettingsStore } from '../../quality/fxSettingsStore'

const triggerMock = vi.fn()

vi.mock('../../render/FxCanvas', () => ({
  FxCanvas: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ trigger: triggerMock }))
    return <div data-testid="fx-canvas-stub" />
  }),
}))

describe('FxLab', () => {
  beforeEach(() => {
    triggerMock.mockClear()
    useFxSettingsStore.setState({ reduceEffects: false })
  })

  it('fires the right tier for each trigger button', async () => {
    render(<FxLab />)

    await userEvent.click(screen.getByRole('button', { name: /fire epic/i }))
    expect(triggerMock).toHaveBeenLastCalledWith({ tier: 'epic', isGoldenNote: false })

    await userEvent.click(screen.getByRole('button', { name: /fire good/i }))
    expect(triggerMock).toHaveBeenLastCalledWith({ tier: 'good', isGoldenNote: false })

    await userEvent.click(screen.getByRole('button', { name: /fire awful/i }))
    expect(triggerMock).toHaveBeenLastCalledWith({ tier: 'awful', isGoldenNote: false })
  })

  it('passes isGoldenNote: true once the golden-note checkbox is checked', async () => {
    render(<FxLab />)

    await userEvent.click(screen.getByRole('checkbox', { name: /golden note/i }))
    await userEvent.click(screen.getByRole('button', { name: /fire epic/i }))

    expect(triggerMock).toHaveBeenLastCalledWith({ tier: 'epic', isGoldenNote: true })
  })

  it('"Fire 4 at once" triggers four times', async () => {
    render(<FxLab />)

    await userEvent.click(screen.getByRole('button', { name: /fire 4 at once/i }))

    expect(triggerMock).toHaveBeenCalledTimes(4)
  })

  it('the reduce-effects toggle updates the settings store', async () => {
    render(<FxLab />)

    await userEvent.click(screen.getByRole('checkbox', { name: /reduce effects/i }))

    expect(useFxSettingsStore.getState().reduceEffects).toBe(true)
  })
})
