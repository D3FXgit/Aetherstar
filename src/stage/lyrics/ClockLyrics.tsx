import { memo, useMemo } from 'react'
import type { MotionValue } from 'framer-motion'
import type { SongLine } from '../../contracts/types'
import { micRimColor } from '../../design/tokens'
import { lyricTracks } from './duetParts'
import { isUsableLyricColor, lyricAccent } from './lyricAccent'
import { LyricBox } from './LyricBox'
import { useLyricCursor } from './lyricCursor'

const ClockLyricTrack = memo(function ClockLyricTrack({
  lines,
  beatPosition,
  compact,
  accentColor,
  part,
}: {
  lines: SongLine[]
  beatPosition: MotionValue<number>
  compact: boolean
  accentColor?: string
  part: string
}) {
  const { lineIndex, syllableIndex, progress } = useLyricCursor(lines, beatPosition)
  return (
    <LyricBox
      lines={lines}
      currentLineIndex={lineIndex}
      activeSyllableIndex={syllableIndex}
      progress={progress}
      compact={compact}
      accentColor={accentColor}
      part={part}
    />
  )
})

/** A duet part's colour: its lane's, or that lane's mic colour when the lane has none (or an unusable one). */
function duetPartColor(partColors: readonly string[] | undefined, lane: number): string {
  return lyricAccent(partColors?.[lane], micRimColor(lane))
}

/**
 * The lyric box, driven by a clock rather than by the stage store: one box for
 * an ordinary song; for a duet two compact boxes (P2 over P1), each in its
 * singer's colour and on its own part's cursor. The same component on the host
 * (duets) and the audience window (everything). Each part's first line is up
 * from the start, so nobody's opening words arrive cold.
 *
 * `partColors` are the singers' colours in lane order (lane 0 sings P1, lane 1
 * P2). An ordinary song takes the colour only when one person is singing it.
 */
export function ClockLyrics({
  lines,
  beatPosition,
  partColors,
}: {
  lines: SongLine[]
  beatPosition: MotionValue<number>
  partColors?: readonly string[]
}) {
  const tracks = useMemo(() => lyricTracks(lines), [lines])
  const duet = tracks.length > 1
  const soloColor = partColors?.length === 1 && isUsableLyricColor(partColors[0]) ? partColors[0] : undefined

  return (
    <div data-testid="clock-lyrics" data-duet={duet ? 'true' : 'false'} className="flex w-full flex-col gap-2">
      {tracks.map((track) => (
        <ClockLyricTrack
          key={track.part}
          lines={track.lines}
          beatPosition={beatPosition}
          compact={duet}
          part={track.part}
          accentColor={duet ? duetPartColor(partColors, track.part === 'p1' ? 0 : 1) : soloColor}
        />
      ))}
    </div>
  )
}
