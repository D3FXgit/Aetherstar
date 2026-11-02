import 'pixi.js/unsafe-eval'
import { Application, ParticleContainer } from 'pixi.js'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { FxTriggerInput } from '../types'
import { acquire, createPool, type Pooled } from './particlePool'
import { getTierPreset } from './tierPresets'

export interface FxCanvasHandle {
  trigger: (input: FxTriggerInput) => void
}

const POOL_SIZE = 200

/**
 * Imperative Pixi.Application mount. The pooled emitter mutates particles inside
 * Pixi's own ticker, outside React, so this never causes a per-frame re-render.
 */
export const FxCanvas = forwardRef<FxCanvasHandle, object>(function FxCanvas(_props, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const poolRef = useRef<Pooled<Record<string, unknown>>[] | null>(null)

  useEffect(() => {
    const app = new Application()
    let cancelled = false

    app.init({ backgroundAlpha: 0, resizeTo: containerRef.current ?? undefined }).then(() => {
      if (cancelled) return
      containerRef.current?.appendChild(app.canvas)
      const particleContainer = new ParticleContainer()
      app.stage.addChild(particleContainer)
      poolRef.current = createPool(POOL_SIZE, () => ({}))
    })

    return () => {
      cancelled = true
      app.destroy()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    trigger(input) {
      const pool = poolRef.current
      if (!pool) return

      const preset = getTierPreset(input.tier, input.isGoldenNote ?? false)
      for (let i = 0; i < preset.particleCount; i++) {
        const particle = acquire(pool)
        if (!particle) break // pool exhausted -- drop silently, never allocate
      }
    },
  }))

  return <div ref={containerRef} data-testid="fx-canvas" className="absolute inset-0 pointer-events-none" />
})
