import { describe, expect, it, vi } from 'vitest'
import { checkMissingAndWarn } from '../loadAssetsDir'
import type { AssetValidationResult } from '../validateAssets'

describe('checkMissingAndWarn', () => {
  it('warns once per missing required asset and returns the missing paths', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const results: AssetValidationResult[] = [
      { path: 'sfx/hit_perfect.wav', present: false, required: true },
      { path: 'sfx/hit_good.wav', present: true, required: true },
      { path: 'sfx/combo_up.wav', present: false, required: false },
    ]

    const missing = checkMissingAndWarn(results)

    expect(missing).toEqual(['sfx/hit_perfect.wav', 'sfx/combo_up.wav'])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sfx/hit_perfect.wav'))

    warn.mockRestore()
  })

  it('warns nothing when every asset is present', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const missing = checkMissingAndWarn([{ path: 'sfx/hit_perfect.wav', present: true, required: true }])

    expect(missing).toEqual([])
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })
})
