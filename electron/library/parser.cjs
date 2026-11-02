// Tolerant UltraStar .txt parser for the library scan: it sniffs the encoding
// and recovers from malformed lines instead of throwing, because real
// libraries are full of them.
//
// Keep in step with src/stage/chart/parseChartText.ts (the renderer's parser;
// neither module system can load the other). fixtures/ultrastar-tolerance/ and
// parserEquivalence.test.ts fail when the two disagree.

// ':' normal, '*' golden, 'F' freestyle (unscored), 'R' rap, 'G' golden rap.
// Rap notes are pitch-free by definition: src/game/matching/judgeNote.ts
// scores them on voiced activity at any pitch, so they keep their own kinds
// rather than being folded into freestyle (which is worth nothing).
const NOTE_KIND_BY_MARKER = { ':': 'normal', '*': 'golden', F: 'freestyle', R: 'rap', G: 'goldenRap' }

// Field 5 (the syllable) is optional: real charts do contain notes with no
// text, and dropping the whole note over a missing syllable loses its pitch
// and its slot in the lyric line.
const NOTE_LINE_PATTERN = /^([:*FRG])\s+(\S+)\s+(\S+)\s+(\S+)(?:\s(.*))?$/
// The second beat only exists in #RELATIVE charts, where it names the next
// line's start offset.
const LINE_BREAK_PATTERN = /^-\s+(\S+)(?:\s+(\S+))?\s*$/
// Both the tight 'P1' and the spaced 'P 1' spellings occur in the wild.
const PLAYER_PART_PATTERN = /^P\s*(\d+)\s*$/i
const END_MARKER_PATTERN = /^\s*E\s*$/i
const TAG_LINE_PATTERN = /^#\s*([^:]+?)\s*:(.*)$/
// Split on CRLF, LF, or a lone CR (classic-Mac saves still turn up).
const LINE_SPLIT_PATTERN = /\r\n|\n|\r/

// #ENCODING values seen in real libraries, mapped to WHATWG labels TextDecoder
// actually accepts. Anything unlisted falls through to windows-1252.
const ENCODING_LABELS = {
  UTF8: 'utf-8',
  'UTF-8': 'utf-8',
  CP1250: 'windows-1250',
  'WINDOWS-1250': 'windows-1250',
  CP1251: 'windows-1251',
  'WINDOWS-1251': 'windows-1251',
  CP1252: 'windows-1252',
  'WINDOWS-1252': 'windows-1252',
  ANSI: 'windows-1252',
  CP1253: 'windows-1253',
  CP1254: 'windows-1254',
  CP1257: 'windows-1257',
  'ISO-8859-1': 'windows-1252',
  LATIN1: 'windows-1252',
}
const DEFAULT_LEGACY_ENCODING = 'windows-1252'

/** #ENCODING declared in bytes that have already failed strict UTF-8, read via a never-failing single-byte pass. */
function sniffDeclaredEncoding(bytes) {
  const head = new TextDecoder(DEFAULT_LEGACY_ENCODING).decode(bytes.subarray(0, 4096))
  const match = head.match(/^\s*#\s*ENCODING\s*:\s*(\S+)/im)
  if (!match) return null
  return ENCODING_LABELS[match[1].trim().toUpperCase()] ?? null
}

/**
 * Bytes -> text, in the order a real library needs:
 *
 * 1. A BOM always wins -- UTF-8, UTF-16LE and UTF-16BE all appear in the wild
 *    (the last two from a Notepad "Unicode" save).
 * 2. Otherwise, bytes that are valid UTF-8 are treated as UTF-8 even when
 *    #ENCODING says otherwise. Valid multi-byte UTF-8 is essentially never an
 *    accident, and files whose bytes were rewritten while the tag was left
 *    behind are common.
 * 3. Only once strict UTF-8 has failed does #ENCODING get consulted -- and a
 *    declaration of UTF-8 on bytes that are demonstrably not UTF-8 is ignored
 *    in favour of windows-1252, the overwhelmingly common legacy encoding.
 */
function decodeSongText(buffer) {
  let bytes = buffer

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const declared = sniffDeclaredEncoding(bytes)
    const label = !declared || declared === 'utf-8' ? DEFAULT_LEGACY_ENCODING : declared
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      return new TextDecoder(DEFAULT_LEGACY_ENCODING).decode(bytes)
    }
  }
}

// Many real-world UltraStar files (authored with European-locale editors)
// write decimal BPM/GAP values with a comma ("326,9") instead of a period.
// `Number('326,9')` is NaN, which silently poisoned every downstream timing
// calculation (gap is the audio-to-lyrics sync offset) -- the song still
// "scanned" successfully, it just could never be sung to correctly.
// The same rule applies to note beats/lengths, so there is exactly one numeric
// reader for the whole format.
function parseNumber(value) {
  if (value === undefined || value === null) return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseDecimalTag(value) {
  return parseNumber(value) ?? 0
}

/**
 * As parseDecimalTag, but for tags where "absent" and "zero" mean different
 * things. An empty declaration (`#VOLUME:`) counts as absent: `Number('')` is
 * 0, which would read as "play this song silently".
 */
function parseOptionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  return parseNumber(value) ?? undefined
}

function isTruthyTag(value) {
  if (value === undefined) return false
  return ['YES', 'TRUE', '1', 'ON'].includes(value.trim().toUpperCase())
}

/** Seconds -> ms, passing undefined through. */
function secondsToMs(seconds) {
  return seconds === undefined ? undefined : seconds * 1000
}

/** `#CALCMEDLEY`: undefined when absent/empty, false for an explicit off switch, true otherwise. */
function parseOptionalSwitch(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  return !['NO', 'FALSE', '0', 'OFF'].includes(String(value).trim().toUpperCase())
}

/** The one wording both parsers use for an unusable #BPM. */
function bpmErrorMessage(rawBpm) {
  const got = rawBpm === undefined || rawBpm === null || String(rawBpm).trim() === '' ? 'missing' : `"${String(rawBpm).trim()}"`
  return `Chart has no usable #BPM (${got}) -- the tag must be a number greater than 0.`
}

/** Every `#TAG:value` line in the file, upper-cased and trimmed, last occurrence winning. */
function readTagMap(lines) {
  const tags = new Map()
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line.startsWith('#')) continue
    const match = line.match(TAG_LINE_PATTERN)
    if (!match) continue
    tags.set(match[1].trim().toUpperCase(), match[2].trim())
  }
  return tags
}

function optionalTag(tags, name) {
  const value = tags.get(name)
  return value ? value : undefined
}

function parseTags(text) {
  return buildMeta(readTagMap(text.split(LINE_SPLIT_PATTERN)))
}

function buildMeta(tags) {
  return {
    artist: tags.get('ARTIST') ?? '',
    title: tags.get('TITLE') ?? '',
    // #AUDIO is the current tag for the full mix; #MP3 is the legacy spelling
    // kept for backwards compatibility, so #AUDIO wins when both are present.
    mp3Path: tags.get('AUDIO') || tags.get('MP3') || '',
    // Separated stems. Absent on the overwhelming majority of charts, which is
    // why both stay optional and playback must work without them.
    vocalsPath: optionalTag(tags, 'VOCALS'),
    instrumentalPath: optionalTag(tags, 'INSTRUMENTAL'),
    videoPath: optionalTag(tags, 'VIDEO'),
    coverPath: optionalTag(tags, 'COVER'),
    // #BACKGROUND: a full-screen still (often `Artist - Title [BG].jpg`), shown
    // when there is no video or it cannot play.
    backgroundPath: optionalTag(tags, 'BACKGROUND'),
    bpm: parseDecimalTag(tags.get('BPM')),
    gap: parseDecimalTag(tags.get('GAP')),
    videoGap: parseDecimalTag(tags.get('VIDEOGAP')),
    // #VOLUME: the chart author's own per-song level trim, a linear multiplier.
    // Rare, but it is the only per-song gain the format itself carries, and it
    // is the only loudness signal available at all for a library that has never
    // been analysed. Undefined rather than 1 when absent, so playback can tell
    // "the author said nothing" from "the author said leave it alone" -- see
    // src/audio/loudness.ts, which multiplies this into the measured gain.
    volume: parseOptionalNumber(tags.get('VOLUME')),
    language: optionalTag(tags, 'LANGUAGE'),
    edition: optionalTag(tags, 'EDITION'),
    // Playback window and medley/preview hints. Units follow the UltraStar
    // format: #START is seconds (exposed as ms, to pair with #END), #END is
    // ms, #PREVIEWSTART is seconds, the medley tags are beats. All undefined
    // when absent.
    startMs: secondsToMs(parseOptionalNumber(tags.get('START'))),
    endMs: parseOptionalNumber(tags.get('END')),
    previewStartSec: parseOptionalNumber(tags.get('PREVIEWSTART')),
    medleyStartBeat: parseOptionalNumber(tags.get('MEDLEYSTARTBEAT')),
    medleyEndBeat: parseOptionalNumber(tags.get('MEDLEYENDBEAT')),
    calcMedley: parseOptionalSwitch(tags.get('CALCMEDLEY')),
  }
}

/**
 * @returns {{ chart: { meta: object, lines: object[] }, warnings: string[] }}
 *
 * Throws when the chart has no usable #BPM (missing, zero, negative or
 * unreadable): every beat<->ms conversion divides by it, so no lenient
 * recovery produces a singable chart. The scan path records the message as a
 * scan error and does not index the song. Same wording as parseChartText.ts.
 */
function parseChart(buffer) {
  const text = decodeSongText(buffer)
  const rawLines = text.split(LINE_SPLIT_PATTERN)
  const tags = readTagMap(rawLines)
  const meta = buildMeta(tags)
  if (!(meta.bpm > 0)) throw new Error(bpmErrorMessage(tags.get('BPM')))
  const relative = isTruthyTag(tags.get('RELATIVE'))
  const { lines, warnings } = parseLines(rawLines, relative)
  return { chart: { meta, lines }, warnings }
}

/**
 * @param {string[]} rawLines every line of the decoded file
 * @param {boolean} relative #RELATIVE:yes -- note beats restart at 0 each line
 *
 * Deliberate deviation from the letter of the legacy (unversioned) format
 * document, which says the relative offset starts at the #GAP value: #GAP is
 * in milliseconds and the offset is in beats, so obeying that literally adds
 * tens of thousands of beats to every note and puts the whole chart past the
 * end of the song. It is a known wart of that document (relative mode was
 * dropped entirely from format v1). Starting at 0 is what produces a singable
 * chart, so that is what this does.
 */
function parseLines(rawLines, relative = false) {
  const result = []
  const warnings = []
  let currentPart = 'solo'
  let current = { part: currentPart, notes: [] }
  // Absolute beat of the current line's origin, per voice. Always 0 outside
  // relative mode. Per voice because the format specifies that each voice
  // carries its own running offset and a voice change does NOT reset it --
  // a P2 section resumes exactly where that voice's previous section left off.
  const relativeOffsets = new Map([['solo', 0]])
  const offsetFor = (part) => relativeOffsets.get(part) ?? 0

  const flushCurrentLine = () => {
    if (current.notes.length > 0) result.push(current)
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (END_MARKER_PATTERN.test(line)) break
    if (line.trimStart().startsWith('#')) continue

    const playerMatch = line.match(PLAYER_PART_PATTERN)
    if (playerMatch) {
      flushCurrentLine()
      const playerNumber = Number(playerMatch[1])
      if (playerNumber > 3) {
        // SongPart only models two singers (plus P3 = both). Folding anything
        // further into P2 keeps its lyrics and notes on screen; dropping the
        // marker's whole section would silently delete part of the song.
        warnings.push(`line ${i + 1}: player marker P${playerNumber} is beyond the two supported parts, folded into P2`)
      }
      // P3 is UltraStar's "both singers" section, which is exactly what a
      // 'solo' line means to the lanes: every singer sings it.
      currentPart = playerNumber <= 1 ? 'p1' : playerNumber === 3 ? 'solo' : 'p2'
      current = { part: currentPart, notes: [] }
      continue
    }

    const noteMatch = line.match(NOTE_LINE_PATTERN)
    if (noteMatch) {
      const [, marker, startBeat, length, pitch, syllable] = noteMatch
      const startBeatNum = parseNumber(startBeat)
      const lengthNum = parseNumber(length)
      const pitchNum = parseNumber(pitch)
      if (startBeatNum === null || lengthNum === null || pitchNum === null) {
        warnings.push(`line ${i + 1}: malformed note line, skipped: "${line}"`)
        continue
      }
      current.notes.push({
        kind: NOTE_KIND_BY_MARKER[marker.toUpperCase()],
        startBeat: startBeatNum + offsetFor(currentPart),
        length: lengthNum,
        pitch: pitchNum,
        syllable: (syllable ?? '').replace(/\s+$/, ''),
      })
      continue
    }

    const lineBreakMatch = line.match(LINE_BREAK_PATTERN)
    if (lineBreakMatch) {
      const breakBeat = parseNumber(lineBreakMatch[1])
      const nextLineBeat = parseNumber(lineBreakMatch[2])
      if (breakBeat === null) {
        warnings.push(`line ${i + 1}: malformed line break, skipped: "${line}"`)
        continue
      }
      current.lineBreakBeat = breakBeat + offsetFor(currentPart)
      flushCurrentLine()
      current = { part: currentPart, notes: [] }
      // In relative mode every following beat restarts from the next line's
      // origin: the second value when the chart supplies one, otherwise the
      // break beat itself.
      if (relative) relativeOffsets.set(currentPart, offsetFor(currentPart) + (nextLineBeat ?? breakBeat))
      continue
    }

    if (line.trim() !== '') {
      warnings.push(`line ${i + 1}: unrecognized line, skipped: "${line}"`)
    }
  }

  flushCurrentLine()
  return { lines: result, warnings }
}

module.exports = { decodeSongText, parseTags, parseChart, parseNumber }
