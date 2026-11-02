import { describe, it, expect, vi, afterEach } from 'vitest'
import { sampleImagePixels, COVER_SAMPLE_SIZE } from '../imagePixelSampler'

/** jsdom's Blob is not accepted by undici's Response, so fetch is faked with the two members the sampler touches. */
function fakeResponse(ok = true) {
  return { ok, blob: async () => ({}) as Blob }
}

/** getContext is overloaded (2d / webgl / webgpu), so the stub goes in through a single `never`-typed seam. */
function stubCanvasContext(context: Partial<CanvasRenderingContext2D>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)
}

const originalFetch = globalThis.fetch
const originalCreateImageBitmap = globalThis.createImageBitmap

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.createImageBitmap = originalCreateImageBitmap
  vi.restoreAllMocks()
})

describe('sampleImagePixels', () => {
  // jsdom implements neither createImageBitmap nor HTMLCanvasElement#getContext.
  // Every one of these paths therefore has to resolve to null rather than throw:
  // the transition is on the critical path to gameplay and must never be taken
  // down by the decorative palette work behind it.
  it('resolves null when the platform has no createImageBitmap (jsdom, old runtimes)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse()) as unknown as typeof fetch
    // @ts-expect-error -- deliberately removing the capability under test
    delete globalThis.createImageBitmap
    await expect(sampleImagePixels('aetherstar-media://roots/cover.jpg')).resolves.toBeNull()
  })

  it('resolves null when the fetch rejects, rather than rejecting itself', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('net::ERR_FILE_NOT_FOUND')) as unknown as typeof fetch
    await expect(sampleImagePixels('aetherstar-media://roots/missing.jpg')).resolves.toBeNull()
  })

  it('resolves null when the protocol answers 404 instead of decoding an empty body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse(false)) as unknown as typeof fetch
    await expect(sampleImagePixels('aetherstar-media://roots/missing.jpg')).resolves.toBeNull()
  })

  it('resolves null when the decode fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse()) as unknown as typeof fetch
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('not an image')) as unknown as typeof createImageBitmap
    await expect(sampleImagePixels('aetherstar-media://roots/corrupt.jpg')).resolves.toBeNull()
  })

  it('resolves null when getImageData throws, the CORS-tainted-canvas case', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse()) as unknown as typeof fetch
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() }) as unknown as typeof createImageBitmap
    stubCanvasContext({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new Error('SecurityError: tainted canvas')
      },
    })
    await expect(sampleImagePixels('aetherstar-media://roots/tainted.jpg')).resolves.toBeNull()
  })

  it('returns the sampled pixel buffer when the whole chain works', async () => {
    const data = new Uint8ClampedArray(COVER_SAMPLE_SIZE * COVER_SAMPLE_SIZE * 4)
    const drawImage = vi.fn()
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse()) as unknown as typeof fetch
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() }) as unknown as typeof createImageBitmap
    stubCanvasContext({ drawImage, getImageData: () => ({ data }) as ImageData })

    await expect(sampleImagePixels('aetherstar-media://roots/cover.jpg')).resolves.toBe(data)
    expect(drawImage).toHaveBeenCalled()
  })
})
