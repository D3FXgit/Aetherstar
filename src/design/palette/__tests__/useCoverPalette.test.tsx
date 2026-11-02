import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useCoverPalette } from '../useCoverPalette'
import type { ImagePixelSampler } from '../imagePixelSampler'

function magentaPixels(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(16 * 4)
  for (let i = 0; i < 16; i++) {
    data[i * 4] = 214
    data[i * 4 + 1] = 32
    data[i * 4 + 2] = 178
    data[i * 4 + 3] = 255
  }
  return data
}

function Probe({ url, sampler }: { url?: string; sampler: ImagePixelSampler }) {
  const palette = useCoverPalette(url, sampler)
  return <span data-testid="hue">{palette ? String(Math.round(palette.primary.h)) : 'none'}</span>
}

describe('useCoverPalette', () => {
  it('returns nothing and never samples when there is no cover to sample', async () => {
    const sampler = vi.fn()
    render(<Probe sampler={sampler as unknown as ImagePixelSampler} />)
    expect(screen.getByTestId('hue')).toHaveTextContent('none')
    expect(sampler).not.toHaveBeenCalled()
  })

  it('resolves an ambient palette from the sampled pixels', async () => {
    const sampler = vi.fn().mockResolvedValue(magentaPixels())
    render(<Probe url="aetherstar-media://roots/cover.jpg" sampler={sampler as unknown as ImagePixelSampler} />)

    await waitFor(() => expect(screen.getByTestId('hue')).not.toHaveTextContent('none'))
    expect(Number(screen.getByTestId('hue').textContent)).toBeGreaterThan(300)
    expect(sampler).toHaveBeenCalledWith('aetherstar-media://roots/cover.jpg')
  })

  it('stays on nothing when the sampler cannot read the image', async () => {
    const sampler = vi.fn().mockResolvedValue(null)
    render(<Probe url="aetherstar-media://roots/cover.jpg" sampler={sampler as unknown as ImagePixelSampler} />)

    await waitFor(() => expect(sampler).toHaveBeenCalled())
    expect(screen.getByTestId('hue')).toHaveTextContent('none')
  })

  it('stays on nothing when every colour in the cover is rejected', async () => {
    const black = new Uint8ClampedArray(16 * 4).fill(255)
    for (let i = 0; i < 16; i++) {
      black[i * 4] = 8
      black[i * 4 + 1] = 8
      black[i * 4 + 2] = 10
    }
    const sampler = vi.fn().mockResolvedValue(black)
    render(<Probe url="aetherstar-media://roots/black.jpg" sampler={sampler as unknown as ImagePixelSampler} />)

    await waitFor(() => expect(sampler).toHaveBeenCalled())
    expect(screen.getByTestId('hue')).toHaveTextContent('none')
  })

  it('swallows a rejected sampler instead of letting it escape as an unhandled rejection', async () => {
    const sampler = vi.fn().mockRejectedValue(new Error('boom'))
    render(<Probe url="aetherstar-media://roots/cover.jpg" sampler={sampler as unknown as ImagePixelSampler} />)

    await waitFor(() => expect(sampler).toHaveBeenCalled())
    expect(screen.getByTestId('hue')).toHaveTextContent('none')
  })

  it('does not apply a result that arrives after unmount', async () => {
    let resolve: (value: Uint8ClampedArray) => void = () => {}
    const sampler = vi.fn().mockReturnValue(new Promise<Uint8ClampedArray>((r) => (resolve = r)))
    const { unmount } = render(<Probe url="aetherstar-media://roots/cover.jpg" sampler={sampler as unknown as ImagePixelSampler} />)

    unmount()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    resolve(magentaPixels())
    await Promise.resolve()
    await Promise.resolve()

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
