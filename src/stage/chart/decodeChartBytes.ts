/**
 * Renderer-side byte -> text step for chart files.
 *
 * MUST behave identically to electron/library/parser.cjs's `decodeSongText`
 * (see the "keeping the two parsers in step" note there); the pairing is
 * enforced by src/stage/chart/__tests__/parserEquivalence.test.ts, which
 * decodes every corpus fixture with both and asserts the strings match.
 *
 * `Response.text()` is a hard-wired UTF-8 decode, and real UltraStar libraries
 * are full of windows-1252 files: every umlaut would arrive as U+FFFD.
 */

// #ENCODING values seen in real libraries, mapped to WHATWG labels TextDecoder
// actually accepts. Anything unlisted falls through to windows-1252.
const ENCODING_LABELS: Record<string, string> = {
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
function sniffDeclaredEncoding(bytes: Uint8Array): string | null {
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
export function decodeChartBytes(buffer: Uint8Array): string {
  const bytes = buffer

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
