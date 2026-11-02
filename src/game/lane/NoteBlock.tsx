import { memo, useCallback } from 'react'
import type { HitTier } from '../../contracts/types'
import type { NoteWithId } from '../types'
import type { PitchRangeScale } from './pitchRangeScale'
import { colorWithAlpha } from '../../players/colors'
import { tokens } from '../../design/tokens'
import { isGoldenKind } from '../effects/noteKindRegistry'

/** Pixels of horizontal scroll per beat unit -- notes scroll right-to-left toward a fixed judgment marker. */
export const PX_PER_BEAT = 24

/** Reference note pills are thick, horizontally elongated and fully rounded (radius = half the height). */
export const NOTE_HEIGHT_PX = 20

/**
 * Rap notes (`R`/`G`) are scored on voice at any pitch, so they must not look
 * like a pitch target: UltraStar draws them hatched, and so does this -- a
 * diagonal stripe over the kind's own fill, with a dashed rim.
 */
const RAP_HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 3px, transparent 3px 7px)'

/**
 * How an *un-sung* note reads: **translucent grey**, whoever sings it. Sung
 * notes are solid in the singer's colour, so the colour means "sung". Golden
 * keeps its gold rim while un-sung: "worth double" is needed *before* the note.
 */
const KIND_FILL: Record<NoteWithId['kind'], string> = {
  normal: 'rgba(226,230,240,0.30)',
  golden: colorWithAlpha(tokens.accent.gold, 0.3),
  freestyle: 'rgba(226,230,240,0.16)',
  rap: `${RAP_HATCH}, rgba(226,230,240,0.20)`,
  goldenRap: `${RAP_HATCH}, ${colorWithAlpha(tokens.accent.gold, 0.3)}`,
}

/** The rim an un-sung note carries, so a golden note is identifiable before anyone sings it. */
const KIND_BORDER: Record<NoteWithId['kind'], string> = {
  normal: '1px solid rgba(255,255,255,0.34)',
  golden: `1px solid ${colorWithAlpha(tokens.accent.gold, 0.95)}`,
  freestyle: '1px solid rgba(255,255,255,0.2)',
  rap: '1px dashed rgba(255,255,255,0.6)',
  goldenRap: `1px dashed ${colorWithAlpha(tokens.accent.gold, 0.95)}`,
}

/**
 * A dark ring immediately outside the pill: with no panel behind the lane, it
 * keeps a pale note visible over a pale video frame. Golden notes add a faint
 * gold halo -- enough to pick them out of a busy lane, not enough to compete
 * with the hit effects.
 */
const NOTE_SHADOW = '0 0 0 1px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.35)'
const GOLDEN_NOTE_SHADOW = `${NOTE_SHADOW}, 0 0 6px ${colorWithAlpha(tokens.accent.gold, 0.25)}`

interface NoteBlockProps {
  note: NoteWithId
  scale: PitchRangeScale
  laneHeightPx: number
  /**
   * A judgement known at render time (labs, static previews, tests), recorded
   * here as `data-hit-tier` for anything that inspects a note declaratively.
   *
   * It is deliberately *not* what paints the cleared state: real gameplay
   * never has a judgement at render time -- a note is judged mid-song, and
   * re-rendering the lane to colour it in would put the note strip back on
   * React's render path. NoteLane writes `data-cleared` imperatively for both
   * cases (see its `declaredClear`), so the preview and the live game land on
   * exactly the same pixels and cannot drift apart.
   */
  hitTier?: HitTier
  /**
   * Pill thickness. Scales down with the lane in a crowded stack (see
   * laneStack.noteHeightForLaneHeight) -- a 20px pill is a third of an
   * eight-player lane, which would make notes an octave apart overlap.
   * Omitted, the solo lane's 20px.
   */
  heightPx?: number
  /**
   * Hands NoteLane this note's DOM node at mount (and `null` at unmount), so a
   * judged note can be cleared with two attribute writes instead of a
   * `querySelector` per hit per lane. Must be referentially stable, or the
   * memo bail-out this component exists for is lost -- see
   * `__tests__/noteLaneCommitCost.test.tsx`.
   */
  onElement?: (noteId: string, element: HTMLDivElement | null) => void
  /**
   * Paged lanes (see linePaging.ts) lay a line across the lane's width, so a
   * note's box is a percentage of the lane rather than beats x PX_PER_BEAT.
   * Omitted keeps the scrolling strip's pixel geometry exactly.
   */
  layout?: { leftPercent: number; widthPercent: number }
}

/**
 * One note, at its own fixed place in the lane's strip.
 *
 * A note's position in the chart is a constant; only the lane's *scroll
 * offset* changes with the clock, and the strip is translated as a whole (see
 * NoteLane). So everything here is written once at mount and never again.
 *
 * Clearing it is *also* written once, and not by React: `data-cleared` is set
 * imperatively by NoteLane when the note is judged, and every pixel of the
 * clear -- the fill sweeping across the pill, the swell, the flash -- is a CSS
 * keyframe on `transform`/`opacity` running off two pseudo-elements this
 * component already owns. No node is added to clear a note, and no note is
 * re-rendered to clear it.
 *
 * Memoised for the same reason: NoteLane re-renders ten times a second to
 * re-cull the visible window, and none of those renders change any note's
 * geometry.
 */
export const NoteBlock = memo(function NoteBlock({
  note,
  scale,
  laneHeightPx,
  hitTier,
  heightPx = NOTE_HEIGHT_PX,
  onElement,
  layout,
}: NoteBlockProps) {
  const left = layout ? `${layout.leftPercent}%` : `${note.startBeat * PX_PER_BEAT}px`
  const top = scale.toY(note.pitch, laneHeightPx)
  const width = layout ? `${layout.widthPercent}%` : `${note.length * PX_PER_BEAT}px`
  const fill = KIND_FILL[note.kind]
  const golden = isGoldenKind(note.kind)
  const { noteId } = note

  // A ref callback rather than a plain ref: NoteLane needs the node, and a
  // memoised NoteBlock renders exactly once per note, so React invokes this
  // once at mount and once (with null) at unmount -- never per frame and never
  // per commit.
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      onElement?.(noteId, element)
    },
    [onElement, noteId],
  )

  return (
    <div
      ref={ref}
      data-testid="note-block"
      data-note-id={noteId}
      data-note-kind={note.kind}
      data-hit-tier={hitTier}
      className="ae-note absolute"
      style={{
        // Pill ends (radius = half the height). A percentage radius would
        // distort into an ellipse on short notes.
        borderRadius: `${heightPx / 2}px`,
        left,
        top: `${top}px`,
        width,
        height: `${heightPx}px`,
        background: fill,
        border: KIND_BORDER[note.kind],
        boxShadow: golden ? GOLDEN_NOTE_SHADOW : NOTE_SHADOW,
      }}
    >
      {/* The live fill: how much of this note the singer is landing *right
          now*, before it is judged. Scaled by one custom property the frame
          loop writes on the note (`--ae-note-live`, 0 when absent) -- a
          compositor-only transform on a node that exists from mount, so the
          fill grows with no React render and no layout. Visual only; the
          judged fill (the note's ::before) replaces it once the note is
          scored. */}
      <span
        aria-hidden
        data-testid="note-live-fill"
        className="pointer-events-none absolute"
        style={{
          inset: 0,
          borderRadius: 'inherit',
          background: 'var(--ae-note-sung, #fff)',
          opacity: 0.55,
          transformOrigin: 'left center',
          transform: 'scaleX(var(--ae-note-live, 0))',
        }}
      />
    </div>
  )
})
