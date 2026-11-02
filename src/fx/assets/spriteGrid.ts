export interface SpriteFrame {
  x: number
  y: number
  width: number
  height: number
}

const GRID_SUFFIX_PATTERN = /_(\d+)x(\d+)\.\w+$/

/** Parses the `name_<cols>x<rows>.png` sprite-sheet convention out of a filename. */
export function parseGridFromFilename(filename: string): { cols: number; rows: number } | null {
  const match = filename.match(GRID_SUFFIX_PATTERN)
  if (!match) return null
  return { cols: Number(match[1]), rows: Number(match[2]) }
}

/** Uniform grid slice, used when no atlas JSON accompanies a sprite sheet. */
export function computeGridFrames(cols: number, rows: number, textureWidth: number, textureHeight: number): SpriteFrame[] {
  const width = textureWidth / cols
  const height = textureHeight / rows
  const frames: SpriteFrame[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      frames.push({ x: col * width, y: row * height, width, height })
    }
  }

  return frames
}
