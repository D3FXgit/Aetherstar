// Which .txt in a folder is "the" UltraStar chart. Shared by the scanner and
// the app-media:// handler so both pick the same file (the library keys songs
// by folder), and stray readme/lyrics .txt files never hide or replace a chart.
const fs = require('node:fs')
const path = require('node:path')

/** How much of each .txt is read to decide whether it is a chart. The header tags always sit at the very top. */
const CHART_SNIFF_BYTES = 16 * 1024
const NUL = String.fromCharCode(0)

/** Reads the first `CHART_SNIFF_BYTES` of a file as text, or null if it cannot be read. */
function readHead(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(CHART_SNIFF_BYTES)
    const bytesRead = fs.readSync(fd, buffer, 0, CHART_SNIFF_BYTES, 0)
    // latin1 never throws and keeps every ASCII header tag intact whether the
    // file is UTF-8, CP1252 or (after dropping NULs) UTF-16 -- the tags are all
    // that is being looked for here; real decoding is the parser's job.
    return buffer.subarray(0, bytesRead).toString('latin1').split(NUL).join('')
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // already closed
      }
    }
  }
}

/**
 * Header text -> does it look like an UltraStar chart?
 *
 * `#TITLE:` is required. Alongside it, any one of `#BPM:`, `#ARTIST:` or an
 * audio tag is enough. A chart missing `#BPM` therefore still counts as a
 * chart here, so its folder is treated as a song folder rather than silently
 * walked past -- the parser then rejects it and the scan records it as a scan
 * error (it is *not* indexed, since an untimeable chart cannot be sung);
 * electron/library/__tests__/scan-worker.test.cjs pins that behaviour.
 */
function looksLikeChartText(text) {
  if (typeof text !== 'string') return false
  const body = stripLeadingByteOrderMark(text)
  if (!/^[ \t]*#TITLE:/im.test(body)) return false
  return /^[ \t]*#(BPM|ARTIST|MP3|AUDIO):/im.test(body)
}

/** A UTF-8 BOM read as latin1 is three non-ASCII characters (a UTF-16 one, two); the header tags never are. */
function stripLeadingByteOrderMark(text) {
  let start = 0
  while (start < 3 && start < text.length && text.charCodeAt(start) > 127) start++
  return text.slice(start)
}

/**
 * Duet charts are a folder's secondary chart whenever a solo one exists beside
 * them. Part markers come both tight (`P1`) and spaced (`P 1`), the same two
 * spellings the parser's PLAYER_PART_PATTERN accepts.
 */
function looksLikeDuet(fileName, text) {
  if (/duet/i.test(fileName)) return true
  if (typeof text !== 'string') return false
  return /^[ \t]*#(P1|P2|DUETSINGERP1|DUETSINGERP2):/im.test(text) || /^[ \t]*P[ \t]*[12][ \t]*\r?$/im.test(text)
}

/**
 * Every .txt in `dir` that looks like an UltraStar chart, best first: solo
 * charts before duets, then the shortest name (so `Artist - Title.txt` beats
 * `Artist - Title (Acoustic).txt`), then plain code-unit order -- never
 * readdir order, which differs between filesystems.
 *
 * @param {string} dir
 * @param {import('node:fs').Dirent[]} [entries] a listing of `dir` the caller already has
 * @returns {string[]} absolute chart paths
 */
function listChartFiles(dir, entries) {
  let listing = entries
  if (!listing) {
    try {
      listing = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }

  const candidates = []
  for (const entry of listing) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue
    const filePath = path.join(dir, entry.name)
    const text = readHead(filePath)
    if (!looksLikeChartText(text)) continue
    candidates.push({ filePath, name: entry.name, duet: looksLikeDuet(entry.name, text) })
  }

  candidates.sort((a, b) => {
    if (a.duet !== b.duet) return a.duet ? 1 : -1
    if (a.name.length !== b.name.length) return a.name.length - b.name.length
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return candidates.map((c) => c.filePath)
}

/** The one chart a folder is indexed and played by, or null when it holds none. */
function pickChartFile(dir, entries) {
  return listChartFiles(dir, entries)[0] ?? null
}

module.exports = {
  CHART_SNIFF_BYTES,
  looksLikeChartText,
  looksLikeDuet,
  listChartFiles,
  pickChartFile,
}
