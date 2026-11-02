import { describe, expect, it } from 'vitest'
import { validateAssets } from '../validateAssets'
import type { AssetSpec } from '../manifest'

const specs: AssetSpec[] = [
  { path: 'sfx/hit_perfect.wav', required: true },
  { path: 'sfx/combo_up.wav', required: false },
  { path: 'fx/star_gold.png', required: true },
]

describe('validateAssets', () => {
  it('reports present/required per path, preserving input order', async () => {
    const present = new Set(['sfx/hit_perfect.wav', 'fx/star_gold.png'])
    const checkExists = (path: string) => Promise.resolve(present.has(path))

    const results = await validateAssets(specs, checkExists)

    expect(results).toEqual([
      { path: 'sfx/hit_perfect.wav', present: true, required: true },
      { path: 'sfx/combo_up.wav', present: false, required: false },
      { path: 'fx/star_gold.png', present: true, required: true },
    ])
  })
})
