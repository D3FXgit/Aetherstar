import { useRef, useState } from 'react'
import { GlassButton } from '../../design/primitives/GlassButton'
import { GlassPanel } from '../../design/primitives/GlassPanel'
import { AmbientFallback } from '../../stage/media/AmbientFallback'
import type { HitTier } from '../../contracts/types'
import { FxCanvas, type FxCanvasHandle } from '../render/FxCanvas'
import { useFxSettingsStore } from '../quality/fxSettingsStore'

/**
 * `/lab/fx`: fires synthetic hits at each tier on demand, over the video-less
 * AmbientFallback backdrop.
 */
export function FxLab() {
  const canvasRef = useRef<FxCanvasHandle>(null)
  const [isGoldenNote, setIsGoldenNote] = useState(false)
  const reduceEffects = useFxSettingsStore((state) => state.reduceEffects)
  const setReduceEffects = useFxSettingsStore((state) => state.setReduceEffects)

  function fire(tier: HitTier) {
    canvasRef.current?.trigger({ tier, isGoldenNote })
  }

  function fireFour() {
    for (let i = 0; i < 4; i++) fire('epic')
  }

  return (
    <div data-testid="fx-lab" className="relative w-full h-full min-h-screen">
      <AmbientFallback coverUrl={null} />
      <FxCanvas ref={canvasRef} />

      <GlassPanel className="absolute top-4 left-4 z-10 p-4 flex flex-col gap-2">
        <GlassButton onClick={() => fire('epic')}>Fire epic</GlassButton>
        <GlassButton onClick={() => fire('good')}>Fire good</GlassButton>
        <GlassButton onClick={() => fire('awful')}>Fire awful</GlassButton>
        <GlassButton onClick={fireFour}>Fire 4 at once</GlassButton>

        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={isGoldenNote} onChange={(event) => setIsGoldenNote(event.target.checked)} />
          Golden note
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={reduceEffects} onChange={(event) => setReduceEffects(event.target.checked)} />
          Reduce effects
        </label>
      </GlassPanel>
    </div>
  )
}
