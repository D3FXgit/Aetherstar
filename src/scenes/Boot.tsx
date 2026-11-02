// The splash shown while the first audio device scan runs. Ready means
// listDevices() has answered once, which proves the audio bridge responds.
// It then hands off to Home with a real navigation (Home renders the same
// HeroFrame), so there is exactly one title screen.
import { useEffect, useState } from 'react'
import { usePitchStore } from '../audio/pitchStore'
import { useSceneStore } from './sceneStore'
import { HeroFrame } from './HeroFrame'
import { micStatusLabel, micStatusPending } from './micStatusLabel'
import { useT } from '../i18n'

export function Boot() {
  const t = useT()
  const [ready, setReady] = useState(false)
  const deviceCount = usePitchStore((state) => state.devices.length)

  useEffect(() => {
    usePitchStore
      .getState()
      .refreshDevices()
      .then(() => setReady(true))
  }, [])

  useEffect(() => {
    // `replace`: the splash is a handoff, never a Back target.
    if (ready) useSceneStore.getState().navigate('home', { replace: true })
  }, [ready])

  return (
    <HeroFrame>
      {!ready && (
        <>
          <div
            data-testid="boot-sweep"
            className="pointer-events-none absolute left-0 right-0 top-[46%] h-[2px]"
            style={{
              background: 'linear-gradient(90deg, transparent, oklch(0.80 0.17 195), transparent)',
              animation: 'aeSweep 3s linear infinite',
            }}
          />
          <p data-testid="boot-status" className="text-base text-ink-tertiary">
            {/* Before the first scan answers, "No mic found" would be a lie. */}
            {deviceCount > 0 ? micStatusLabel(deviceCount, t) : micStatusPending(t)}
          </p>
        </>
      )}
    </HeroFrame>
  )
}
