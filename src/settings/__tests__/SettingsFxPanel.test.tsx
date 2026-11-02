import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsFxPanel } from '../SettingsFxPanel'
import { useFxSettingsStore } from '../../fx/quality/fxSettingsStore'

describe('SettingsFxPanel', () => {
  beforeEach(() => {
    useFxSettingsStore.setState({ reduceEffects: false })
  })

  it('renders the reduceEffects toggle reflecting the store', () => {
    render(<SettingsFxPanel />)
    expect(screen.getByRole('checkbox', { name: /reduce effects/i })).not.toBeChecked()
  })

  it('toggling calls setReduceEffects', () => {
    render(<SettingsFxPanel />)
    fireEvent.click(screen.getByRole('checkbox', { name: /reduce effects/i }))
    expect(useFxSettingsStore.getState().reduceEffects).toBe(true)
  })
})
