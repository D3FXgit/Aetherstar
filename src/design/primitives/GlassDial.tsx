// A small gauge: a needle (a CSS-rotated bar) over a numeric readout.
import { motion, useMotionValue } from 'framer-motion'
import { useEffect } from 'react'
import { GlassPanel } from './GlassPanel'
import { tokens } from '../tokens'
import { dialAngleForValue } from './dialAngleForValue'

interface GlassDialProps {
  label: string
  value: number | null
  min: number
  max: number
  unit: string
}

export function GlassDial({ label, value, min, max, unit }: GlassDialProps) {
  const needleAngle = useMotionValue(dialAngleForValue(value ?? min, min, max))

  useEffect(() => {
    needleAngle.set(dialAngleForValue(value ?? min, min, max))
  }, [value, min, max, needleAngle])

  return (
    <GlassPanel className="p-4 flex flex-col gap-3 items-center w-48" data-testid="glass-dial">
      <span className="text-sm font-semibold truncate text-ink-secondary">{label}</span>

      <div className="relative h-16 flex items-end justify-center overflow-hidden" data-testid="glass-dial-needle">
        <motion.div
          className="w-1 h-14 rounded-full origin-bottom"
          style={{ backgroundColor: tokens.accent.gold, rotate: needleAngle }}
        />
      </div>

      <p data-testid="glass-dial-value" className="text-lg font-semibold text-ink-primary">
        {value !== null ? `${Math.round(value)} ${unit}` : `-- ${unit}`}
      </p>
    </GlassPanel>
  )
}
