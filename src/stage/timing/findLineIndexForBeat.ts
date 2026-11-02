import type { SongLine } from '../../contracts/types'

/**
 * The beat at which the display moves on from `lines[index]` to the line
 * after it: the line's own `-` break marker when the chart has one (UltraStar
 * and USDX page the lyrics there, so the next line is up *before* it starts),
 * else the next line's first note -- and never later than that first note.
 */
export function lineSwitchBeat(lines: SongLine[], index: number): number {
  const nextStart = lines[index + 1]?.notes[0]?.startBeat ?? Infinity
  const breakBeat = lines[index]?.lineBreakBeat
  return breakBeat !== undefined && Number.isFinite(breakBeat) ? Math.min(breakBeat, nextStart) : nextStart
}

/**
 * The line on display at `beat`, clamped to the chart's bounds: the greatest
 * index whose predecessor's switch point (see `lineSwitchBeat`) has passed.
 */
export function findLineIndexForBeat(lines: SongLine[], beat: number): number {
  if (lines.length === 0) return 0

  let index = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].notes.length === 0) continue
    if (lineSwitchBeat(lines, i - 1) <= beat) index = i
  }
  return index
}
