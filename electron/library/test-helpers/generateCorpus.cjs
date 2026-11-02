// Synthetic fixture-corpus generator -- keeps the repo free of committed
// binary song stand-ins.
const fs = require('node:fs')
const path = require('node:path')

const LANGUAGES = ['English', 'German', 'Spanish']
const EDITIONS = ['Party Classics', 'UltraStar', undefined]

function chartText({ artist, title, language, edition, malformed, bpm = 200, gap = 500 }) {
  const lines = [
    `#ARTIST:${artist}`,
    `#TITLE:${title}`,
    `#MP3:song.mp3`,
    `#BPM:${bpm}`,
    `#GAP:${gap}`,
  ]
  if (language) lines.push(`#LANGUAGE:${language}`)
  if (edition) lines.push(`#EDITION:${edition}`)

  lines.push(': 0 2 60 la ')
  if (malformed) lines.push(': notanumber 2 60 broken ')
  lines.push(': 4 2 62 la ')
  lines.push('E')

  return lines.join('\n') + '\n'
}

/**
 * Writes `count` synthetic song folders under `rootDir` for scanner/parser/search
 * testing -- no real media, only .txt files (and matching #MP3 tags, which
 * don't need to resolve to real files for parse/scan/search coverage).
 */
function generateCorpus(rootDir, { count = 40 } = {}) {
  fs.mkdirSync(rootDir, { recursive: true })
  const titles = []

  for (let i = 0; i < count; i++) {
    const artist = `Artist ${i % 10}`
    const title = `Song Title ${i}`
    const language = LANGUAGES[i % LANGUAGES.length]
    const edition = EDITIONS[i % EDITIONS.length]
    const malformed = i === 1 // exactly one deliberately malformed entry
    const nonUtf8 = i === 2 // exactly one non-UTF-8-encoded entry

    const songDir = path.join(rootDir, `song-${i}`)
    fs.mkdirSync(songDir, { recursive: true })

    if (nonUtf8) {
      const text = chartText({ artist: 'Café Band', title, language, edition, malformed: false })
      // Re-encode the artist line's accented byte as windows-1252 (0xE9), matching
      // parser.cjs's decodeSongText fallback path.
      const utf8Buffer = Buffer.from(text, 'utf-8')
      const cp1252Artist = Buffer.from('#ARTIST:Caf', 'utf-8')
      const rest = utf8Buffer.subarray(utf8Buffer.indexOf('\n'))
      fs.writeFileSync(path.join(songDir, 'notes.txt'), Buffer.concat([cp1252Artist, Buffer.from([0xe9]), rest]))
    } else {
      fs.writeFileSync(path.join(songDir, 'notes.txt'), chartText({ artist, title, language, edition, malformed }), 'utf-8')
    }

    fs.writeFileSync(path.join(songDir, 'song.mp3'), 'fake-mp3-bytes')
    titles.push(title)
  }

  return { count, titles }
}

module.exports = { generateCorpus }
