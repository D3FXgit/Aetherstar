import { useEffect, useState } from 'react'
import { GlassToggle } from '../design/primitives/GlassToggle'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import type { WindowDisplayMode } from './types'
import { useT } from '../i18n'

/**
 * The way out of full screen.
 *
 * AetherStar starts full screen (electron/main.cjs), which is right for the
 * room it is played in and wrong for anyone who cannot find the way back --
 * "stuck on a screen with no visible exit" is the failure this panel exists to
 * prevent, so the control is always drawn, on every platform, rather than only
 * where the OS has nothing of its own.
 *
 * The description names the *platform's* escape hatch as well, because on macOS
 * the toggle is the second-best route: the window is a real full-screen space,
 * so the green button in the auto-revealing title bar (or Control-Command-F)
 * gets someone out without them having reached Settings at all. On Windows
 * there is no such gesture and this toggle is the only route, which is exactly
 * how the user described it.
 *
 * Escape is deliberately not offered here. It is already the app-wide
 * Back/abandon binding (src/App.tsx), and a key that both leaves a song and
 * leaves full screen is a key that does the wrong one half the time.
 */
export function SettingsWindowPanel() {
  const [mode, setMode] = useState<WindowDisplayMode | null>(null)
  const t = useT()

  useEffect(() => {
    let cancelled = false
    void window.api?.window?.getDisplayMode().then((next) => {
      if (!cancelled) setMode(next)
    })
    // The window can also change underneath this pane -- the macOS green
    // button, Control-Command-F, a window manager. Subscribing means the switch
    // describes the window rather than the last thing the user clicked in here.
    const unsubscribe = window.api?.window?.onDisplayModeChanged((next) => setMode(next))
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const platform = mode?.platform ?? ''
  const description =
    platform === 'darwin' ? t('settings.window.windowed.descriptionMac') : t('settings.window.windowed.description')

  return (
    <SettingsPanel title={t('settings.window.title')} testId="settings-window-panel">
      <SettingsRow label={t('settings.window.windowed.label')} description={description}>
        <GlassToggle
          label={t('settings.window.windowed.label')}
          data-testid="settings-windowed-toggle"
          checked={mode?.windowed ?? false}
          disabled={mode === null}
          onChange={async (windowed) => {
            // Optimistic, then corrected by whatever the main process reports:
            // a switch that waits for a full-screen animation to finish before
            // moving reads as broken.
            setMode((prev) => (prev ? { ...prev, windowed } : prev))
            const next = await window.api?.window?.setWindowed(windowed)
            if (next) setMode(next)
          }}
        />
      </SettingsRow>
    </SettingsPanel>
  )
}
