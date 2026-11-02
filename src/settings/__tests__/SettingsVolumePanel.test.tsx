import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SettingsVolumePanel } from '../SettingsVolumePanel'
import { MIXER_ROWS } from '../mixerRows'
import { DEFAULT_MIXER_VOLUMES, useAppPreferencesStore } from '../appPreferencesStore'
import { t } from '../../i18n'

afterEach(() => {
  useAppPreferencesStore.setState({ mixer: { ...DEFAULT_MIXER_VOLUMES }, menuMusicMode: 'library' })
})

describe('SettingsVolumePanel', () => {
  it('shows one slider per mixer channel', () => {
    render(<SettingsVolumePanel />)
    for (const row of MIXER_ROWS) {
      expect(screen.getByRole('slider', { name: `${t(row.labelKey)} volume` })).toBeInTheDocument()
    }
    expect(MIXER_ROWS.map((row) => row.channel)).toEqual(['master', 'music', 'guideVocals', 'effects', 'menuMusic'])
  })

  it('writes a slider move to the preferences store', () => {
    render(<SettingsVolumePanel />)
    fireEvent.change(screen.getByTestId('settings-volume-effects'), { target: { value: '0.3' } })
    expect(useAppPreferencesStore.getState().mixer.effects).toBeCloseTo(0.3, 10)
  })

  it('reflects the stored level', () => {
    useAppPreferencesStore.setState({ mixer: { ...DEFAULT_MIXER_VOLUMES, menuMusic: 0.4 } })
    render(<SettingsVolumePanel />)
    expect(screen.getByTestId('settings-volume-menuMusic')).toHaveValue('0.4')
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('keeps every description to one short sentence with no em-dash', () => {
    for (const row of MIXER_ROWS) {
      const description = t(row.descriptionKey)
      // A missing key would come back as the key itself and sail through the checks below.
      expect(description).not.toBe(row.descriptionKey)
      expect(description).not.toMatch(/\u2014/)
      expect(description.split('. ').length).toBe(1)
    }
  })

  describe('menu music source', () => {
    it('offers library songs (selected by default), the built-in track and off', () => {
      render(<SettingsVolumePanel />)
      const group = screen.getByRole('radiogroup', { name: 'Menu music source' })
      const options = Array.from(group.querySelectorAll('[role="radio"]'))
      expect(options.map((option) => option.textContent)).toEqual(['Songs from your library', 'Built-in track', 'Off'])
      expect(screen.getByRole('radio', { name: 'Songs from your library' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
    })

    it('stores the choice', () => {
      render(<SettingsVolumePanel />)
      fireEvent.click(screen.getByRole('radio', { name: 'Built-in track' }))
      expect(useAppPreferencesStore.getState().menuMusicMode).toBe('builtin')
      expect(screen.getByRole('radio', { name: 'Built-in track' })).toHaveAttribute('aria-checked', 'true')

      fireEvent.click(screen.getByRole('radio', { name: 'Off' }))
      expect(useAppPreferencesStore.getState().menuMusicMode).toBe('off')
    })
  })
})
