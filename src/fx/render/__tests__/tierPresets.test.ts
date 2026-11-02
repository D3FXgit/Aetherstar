import { describe, expect, it } from 'vitest'
import { getTierPreset } from '../tierPresets'
import { tokens } from '../../../design/tokens'

describe('getTierPreset', () => {
  it('EPIC: shards + gold star, gold accent, shake + glow, hit_perfect', () => {
    const preset = getTierPreset('epic', false)
    expect(preset.spriteNames).toEqual(expect.arrayContaining(['shards_epic', 'star_gold']))
    expect(preset.color).toBe(tokens.accent.gold)
    expect(preset.screenShake).toBe(true)
    expect(preset.screenGlow).toBe(true)
    expect(preset.sfxName).toBe('hit_perfect')
  })

  it('golden-note EPIC is a distinct, more intense variant', () => {
    const standard = getTierPreset('epic', false)
    const golden = getTierPreset('epic', true)
    expect(golden.particleCount).toBeGreaterThan(standard.particleCount)
  })

  it('GOOD: neon trail, cyan accent, no glow', () => {
    const preset = getTierPreset('good', false)
    expect(preset.spriteNames).toEqual(expect.arrayContaining(['trail_neon']))
    expect(preset.color).toBe(tokens.accent.cyan)
    expect(preset.screenGlow).toBe(false)
    expect(preset.sfxName).toBe('hit_good')
  })

  it('AWFUL: smoke/glitch, a dimmed coral (not the raw accent), hit_miss', () => {
    const preset = getTierPreset('awful', false)
    expect(preset.spriteNames).toEqual(expect.arrayContaining(['smoke_soft', 'glitch_tile']))
    expect(preset.color).not.toBe(tokens.accent.coral)
    expect(typeof preset.color).toBe('string')
    expect(preset.color.length).toBeGreaterThan(0)
    expect(preset.sfxName).toBe('hit_miss')
  })
})
