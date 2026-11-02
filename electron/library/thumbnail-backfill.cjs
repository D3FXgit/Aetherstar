// Main-process cover-thumbnail backfill, run after each library scan.
//
// The scan worker indexes cover_path but cannot make thumbnails (nativeImage
// is not usable inside a worker_threads Worker -- see scan-worker.cjs), so the
// main process fills them in afterwards -- one song at a time with a yield to
// the event loop between songs, so a big library never holds the main thread
// (and the live pitch relay) for seconds. File writes are async, DB updates
// are batched per `batchSize` songs, and the whole thing waits while a song
// is being sung.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const THUMBNAIL_WIDTH = 240
const THUMBNAIL_JPEG_QUALITY = 80
const DEFAULT_BATCH_SIZE = 25

/** Same naming as scan-worker.cjs's generateThumbnail, so either path finds the other's files. */
function thumbnailPathFor(thumbnailsDir, songPath) {
  return path.join(thumbnailsDir, `${crypto.createHash('sha1').update(songPath).digest('hex')}.jpg`)
}

/** Decode + resize + JPEG-encode one cover with Electron's nativeImage, or null. */
function encodeThumbnail(nativeImage, coverAbsPath) {
  if (!nativeImage || !coverAbsPath) return null
  try {
    const image = nativeImage.createFromPath(coverAbsPath)
    if (image.isEmpty()) return null
    return image.resize({ width: THUMBNAIL_WIDTH }).toJPEG(THUMBNAIL_JPEG_QUALITY)
  } catch {
    return null
  }
}

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve))

/**
 * @param {{
 *   pending: { path: string, cover_path: string }[],
 *   thumbnailsDir: string,
 *   encode: (coverPath: string) => Buffer | null,
 *   commit: (entries: { path: string, thumbnailPath: string }[]) => void,
 *   writeFile?: (file: string, data: Buffer) => Promise<void>,
 *   whenIdle?: () => Promise<void>,
 *   isCancelled?: () => boolean,
 *   yieldFn?: () => Promise<void>,
 *   batchSize?: number,
 * }} options
 * @returns {Promise<{ generated: number, failed: number, cancelled: boolean }>}
 */
async function runThumbnailBackfill({
  pending,
  thumbnailsDir,
  encode,
  commit,
  writeFile = (file, data) => fs.promises.writeFile(file, data),
  whenIdle = () => Promise.resolve(),
  isCancelled = () => false,
  yieldFn = yieldToEventLoop,
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  let generated = 0
  let failed = 0
  let batch = []
  const flush = () => {
    if (batch.length === 0) return
    const entries = batch
    batch = []
    commit(entries)
  }

  if (pending.length > 0) await fs.promises.mkdir(thumbnailsDir, { recursive: true }).catch(() => {})

  for (const song of pending) {
    await whenIdle()
    await yieldFn()
    if (isCancelled()) {
      flush()
      return { generated, failed, cancelled: true }
    }
    const jpeg = encode(song.cover_path)
    if (!jpeg) {
      failed++
      continue
    }
    const thumbnailPath = thumbnailPathFor(thumbnailsDir, song.path)
    try {
      await writeFile(thumbnailPath, jpeg)
    } catch {
      failed++
      continue
    }
    generated++
    batch.push({ path: song.path, thumbnailPath })
    if (batch.length >= batchSize) flush()
  }

  flush()
  return { generated, failed, cancelled: false }
}

module.exports = { runThumbnailBackfill, encodeThumbnail, thumbnailPathFor, DEFAULT_BATCH_SIZE }
