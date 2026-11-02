export interface CropAreaPixels {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Draws the crop-box region of `sourceDataUrl` (rotated by `rotationDegrees`
 * around its own center) into an `outputSize` x `outputSize` canvas and
 * returns it as a JPEG data URL. jsdom has no real canvas rendering, so this
 * is tested against a mocked CanvasRenderingContext2D, not real pixel output.
 */
export function cropImageToDataUrl(
  sourceDataUrl: string,
  cropAreaPixels: CropAreaPixels,
  rotationDegrees: number,
  outputSize: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = outputSize
      canvas.height = outputSize
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('cropImageToDataUrl: 2d canvas context unavailable'))
        return
      }

      if (rotationDegrees !== 0) {
        ctx.translate(outputSize / 2, outputSize / 2)
        ctx.rotate((rotationDegrees * Math.PI) / 180)
        ctx.translate(-outputSize / 2, -outputSize / 2)
      }

      ctx.drawImage(
        image,
        cropAreaPixels.x,
        cropAreaPixels.y,
        cropAreaPixels.width,
        cropAreaPixels.height,
        0,
        0,
        outputSize,
        outputSize,
      )

      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    image.onerror = () => reject(new Error('cropImageToDataUrl: failed to load source image'))
    image.src = sourceDataUrl
  })
}
