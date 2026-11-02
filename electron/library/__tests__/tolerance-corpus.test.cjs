// @vitest-environment node
//
// The tolerance rule table: every real-world .txt variation the parser must
// survive, against the byte-exact fixtures in fixtures/ultrastar-tolerance/.
// Twin: src/stage/chart/__tests__/parserEquivalence.test.ts runs the renderer
// parser over the same bytes, so the two parsers cannot drift apart.
const fs = require('node:fs')
const path = require('node:path')
const { parseChart, decodeSongText } = require('../parser.cjs')

const CORPUS_DIR = path.join(__dirname, '..', '..', '..', 'fixtures', 'ultrastar-tolerance')

function load(name) {
  return parseChart(fs.readFileSync(path.join(CORPUS_DIR, name)))
}

describe('tolerance corpus — encoding', () => {
  it('01: strips a UTF-8 BOM, splits CRLF, and stops at a trailing-space "E" terminator', () => {
    const { chart, warnings } = load('01-bom-crlf.txt')

    expect(chart.meta.artist).toBe('BOM Artist')
    expect(chart.meta.title).toBe('CRLF Title')
    expect(chart.meta.bpm).toBe(250)
    expect(chart.lines).toHaveLength(2)
    expect(chart.lines[0].lineBreakBeat).toBe(10)
    expect(chart.lines[1].notes[0].syllable).toBe('world')
    // The junk line after "E " is past the end marker, so it is not a warning.
    expect(warnings).toEqual([])
  })

  it('02: decodes declared windows-1252 bytes rather than producing U+FFFD', () => {
    const { chart } = load('02-cp1252.txt')

    expect(chart.meta.artist).toBe('Grünemann')
    expect(chart.meta.title).toBe('Café')
    expect(chart.lines[0].notes[0].syllable).toBe('Gründ')
    // 0x92 is a curly apostrophe in CP1252, not an unassigned byte.
    expect(chart.lines[0].notes[1].syllable).toBe('don’t')
  })

  it('03: honours #ENCODING:CP1250 instead of assuming CP1252 for every non-UTF-8 file', () => {
    const { chart } = load('03-cp1250.txt')

    // 0x9C is U+015B in CP1250 but U+0153 ("oe") in CP1252 -- only an
    // #ENCODING-aware decoder gets this right.
    expect(chart.meta.artist).toBe('śpiewak')
  })

  it('14: splits lone-CR (classic Mac) line endings', () => {
    const { chart, warnings } = load('14-lone-cr.txt')

    expect(chart.meta.artist).toBe('Old Mac')
    expect(chart.meta.bpm).toBe(100)
    expect(chart.lines[0].notes[0].syllable).toBe('la')
    expect(warnings).toEqual([])
  })

  it('15: decodes a UTF-16LE file by its BOM', () => {
    const { chart, warnings } = load('15-utf16le.txt')

    expect(chart.meta.artist).toBe('UTF16')
    expect(chart.meta.title).toBe('Little Endian')
    expect(chart.lines[0].notes[0].syllable).toBe('la')
    expect(warnings).toEqual([])
  })

  it('17: decodes a UTF-16BE file by its BOM', () => {
    const { chart, warnings } = load('17-utf16be.txt')

    expect(chart.meta.artist).toBe('UTF16BE')
    expect(chart.lines[0].notes[0].syllable).toBe('la')
    expect(warnings).toEqual([])
  })

  it('decodeSongText prefers real UTF-8 over a wrong #ENCODING declaration', () => {
    // Files declaring CP1252 while actually being UTF-8 are extremely common
    // (an editor rewrote the bytes but left the tag). Valid UTF-8 is never an
    // accident, so it always wins.
    const bytes = Buffer.from('#ENCODING:CP1252\n#ARTIST:Grün\n', 'utf-8')
    expect(decodeSongText(bytes)).toContain('Grün')
  })

  it('decodeSongText falls back to windows-1252 when #ENCODING:UTF8 is a lie', () => {
    const bytes = Buffer.concat([Buffer.from('#ENCODING:UTF8\n#ARTIST:Gr', 'latin1'), Buffer.from([0xfc]), Buffer.from('n\n', 'latin1')])
    expect(decodeSongText(bytes)).toContain('Grün')
  })
})

describe('tolerance corpus — header', () => {
  it('04: accepts tag-name case variance, spaces around the colon, and indentation', () => {
    const { chart, warnings } = load('04-tag-variance.txt')

    expect(chart.meta.artist).toBe('lower Case Artist')
    expect(chart.meta.title).toBe('Indented Tag')
    expect(chart.meta.mp3Path).toBe('song.mp3')
    expect(chart.meta.language).toBe('German')
    expect(chart.meta.edition).toBe('Party')
    expect(warnings).toEqual([])
  })

  it('04: reads comma-decimal numerics, including a negative #GAP', () => {
    const { chart } = load('04-tag-variance.txt')

    expect(chart.meta.bpm).toBe(240.5)
    // A negative gap is legal: it means the lyrics start before the audio's
    // own zero, which happens when a song is cut from a longer recording.
    expect(chart.meta.gap).toBe(-250.75)
    expect(chart.meta.videoGap).toBe(1.5)
  })

  // #VOLUME is the only per-song gain the UltraStar format itself carries, and
  // for a library that has never been analysed it is the only loudness signal
  // there is. src/audio/loudness.ts multiplies it into the measured gain.
  it('18: reads #VOLUME as a comma-decimal author trim', () => {
    const { chart, warnings } = load('18-volume.txt')

    expect(chart.meta.volume).toBe(0.7)
    expect(warnings).toEqual([])
  })

  it('04/19: leaves #VOLUME undefined -- not 1, and not 0 -- when it is absent or empty', () => {
    // The distinction is load bearing at playback: "the author said nothing"
    // leaves the level to the measurement alone, while a declared value is an
    // explicit trim on top of it. Defaulting to 0 would mute the song.
    expect(load('04-tag-variance.txt').chart.meta.volume).toBeUndefined()
    expect(load('19-volume-empty.txt').chart.meta.volume).toBeUndefined()
    expect(load('19-volume-empty.txt').warnings).toEqual([])
  })

  it('05: defaults a missing #GAP to 0 without warning', () => {
    const { chart, warnings } = load('05-missing-gap.txt')

    expect(chart.meta.gap).toBe(0)
    expect(chart.meta.bpm).toBe(180)
    expect(chart.lines).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  it('08: reads the medley/preview/playback-window tags and ignores unknown and colon-less tags silently', () => {
    const { chart, warnings } = load('08-medley-unknown.txt')

    expect(chart.meta.artist).toBe('Medley')
    expect(chart.meta.previewStartSec).toBe(42.5)
    expect(chart.meta.medleyStartBeat).toBe(64)
    expect(chart.meta.medleyEndBeat).toBe(128)
    expect(chart.meta.calcMedley).toBe(false)
    expect(chart.meta.startMs).toBe(12500)
    expect(chart.meta.endMs).toBe(180000)
    expect(chart.lines).toHaveLength(1)
    expect(chart.lines[0].notes).toHaveLength(2)
    // Blank and whitespace-only body lines are not warnings either.
    expect(warnings).toEqual([])
  })
})

describe('tolerance corpus — body', () => {
  it('06: converts #RELATIVE:yes beats to absolute using each line break\'s second value', () => {
    const { chart, warnings } = load('06-relative.txt')

    expect(warnings).toEqual([])
    expect(chart.lines.map((l) => l.notes.map((n) => n.startBeat))).toEqual([
      [0, 4],
      [8, 12],
      [16],
    ])
    expect(chart.lines.map((l) => l.lineBreakBeat)).toEqual([8, 16, undefined])
  })

  it('16: gives each voice in a #RELATIVE duet its own running offset, unreset by a voice change', () => {
    const { chart, warnings } = load('16-relative-duet.txt')

    expect(warnings).toEqual([])
    // P1 resumes at beat 4 -- where its own previous section left off -- even
    // though a whole P2 section ran in between.
    expect(chart.lines.map((l) => [l.part, l.notes.map((n) => n.startBeat)])).toEqual([
      ['p1', [0]],
      ['p1', [4]],
      ['p2', [0]],
      ['p2', [4]],
      ['p1', [4]],
    ])
    // #GAP is milliseconds and the offset is beats, so #GAP:5000 must not leak
    // into the beat numbers (see parseLines' note on the legacy spec's wart).
    expect(chart.meta.gap).toBe(5000)
  })

  it('07: recognises P1/"P 2" player markers and maps P3 ("both") to a shared line', () => {
    const { chart, warnings } = load('07-duet.txt')

    expect(chart.lines.map((l) => l.part)).toEqual(['p1', 'p2', 'solo'])
    expect(chart.lines[0].notes.map((n) => n.syllable)).toEqual(['Al', 'ice'])
    expect(chart.lines[1].notes.map((n) => n.syllable)).toEqual(['Bo', 'b'])
    expect(chart.lines[2].notes.map((n) => n.syllable)).toEqual(['third'])
    expect(warnings).toEqual([])
  })

  it('09: skips malformed note lines and keeps every good one, one warning each', () => {
    const { chart, warnings } = load('09-malformed-notes.txt')

    const syllables = chart.lines.flatMap((l) => l.notes.map((n) => n.syllable))
    expect(syllables).toEqual(['good', 'also good', '', 'golden', 'freestyle', 'comma length'])
    expect(chart.lines.flatMap((l) => l.notes.map((n) => n.kind))).toEqual([
      'normal',
      'normal',
      'normal',
      'golden',
      'freestyle',
      'normal',
    ])
    // ': 28 4,5 68 ...' -- the same comma-decimal tolerance the header gets.
    expect(chart.lines.flatMap((l) => l.notes).at(-1).length).toBe(4.5)
    expect(warnings).toHaveLength(3)
    expect(warnings.every((w) => /^line \d+: /.test(w))).toBe(true)
  })

  it('10: accepts R (rap) and G (golden rap) note markers as their own pitch-free kinds', () => {
    const { chart, warnings } = load('10-rap-notes.txt')

    // Rap notes are pitch-free by definition and are scored on voiced
    // activity (src/game/matching/judgeNote.ts) -- not folded into freestyle,
    // which is worth nothing.
    expect(chart.lines[0].notes.map((n) => n.kind)).toEqual(['rap', 'goldenRap', 'normal'])
    expect(chart.lines[0].notes.map((n) => n.syllable)).toEqual(['spit', 'fire', 'sung'])
    expect(warnings).toEqual([])
  })

  it('13: a header-only chart parses to zero lines rather than throwing', () => {
    const { chart, warnings } = load('13-no-notes.txt')

    expect(chart.lines).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('tolerance corpus — audio and stems', () => {
  it('11: prefers #AUDIO over the legacy #MP3 and reads both stem tags', () => {
    const { chart } = load('11-stems.txt')

    expect(chart.meta.mp3Path).toBe('full-mix.mp3')
    expect(chart.meta.vocalsPath).toBe('vocals.mp3')
    expect(chart.meta.instrumentalPath).toBe('instrumental.mp3')
  })

  it('12: a stems-only chart has no full mix', () => {
    const { chart } = load('12-stems-only.txt')

    expect(chart.meta.mp3Path).toBe('')
    expect(chart.meta.vocalsPath).toBe('vocals.ogg')
    expect(chart.meta.instrumentalPath).toBe('instrumental.ogg')
  })

  it('leaves both stem fields undefined for a chart that declares none', () => {
    const { chart } = load('05-missing-gap.txt')

    expect(chart.meta.vocalsPath).toBeUndefined()
    expect(chart.meta.instrumentalPath).toBeUndefined()
  })
})
