import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { motion, motionValue, useReducedMotion, useTransform, type MotionValue } from 'framer-motion'
import type { HitTier } from '../../contracts/types'
import type { JudgedHit, NoteWithId } from '../types'
import { NoteBlock, NOTE_HEIGHT_PX, PX_PER_BEAT } from './NoteBlock'
import { useLanePageIndex, useLanePaging } from './LanePagingContext'
import { noteLayoutOnPage } from './linePaging'
import { forceCompositeLayer } from './forceCompositeLayer'
import { computePitchRangeScaleFromPitches, type PitchRangeScale } from './pitchRangeScale'
import { GOLDEN_COLOR, TIER_COLOR } from '../hud/tierColor'
import { useHitStore } from '../state/useHitStore'
import { isGoldenKind, registerNoteKinds } from '../effects/noteKindRegistry'

/**
 * How much chart is mounted either side of the playhead, in beats.
 *
 * 68 beats is 1632px each side, which covers the widest lane this layout can
 * produce (up to ~1560px of upcoming chart on a large display); any less and
 * notes would appear out of nothing inside the lane. Mounted notes cost nothing
 * per frame -- only a slightly longer cull pass ten times a second.
 *
 * In time, at the corrected clock: ~4.1s of lookahead at the 250 BPM fixture,
 * ~8.5s at 120 BPM. `PX_PER_BEAT` stays at 24 -- the pill proportions are
 * drawn against it, and 400px/s at 250 BPM is where a scrolling-note game
 * should sit.
 */
export const DEFAULT_VISIBLE_BEAT_WINDOW = 68

/**
 * How coarsely the scrolling lane re-culls when it follows the live clock on
 * its own: once per this many beats, i.e. a handful of renders a second at
 * most, against a window of ±DEFAULT_VISIBLE_BEAT_WINDOW.
 */
const CULL_STEP_BEATS = 8

/** Written from the frame loop: how much of a note the singer is landing right now. */
export interface LiveFillHandle {
  /** 0..1 of `noteId`'s length sung within tolerance so far. Visual only. */
  set(noteId: string, fraction: number): void
}

interface NoteLaneProps {
  notes: NoteWithId[]
  /**
   * A beat value for which notes are mounted, and the scroll offset when there
   * is no live clock (labs, static previews, tests). Omitted with a live
   * `beatPosition`, the lane re-culls itself from the clock -- coarsely, so the
   * strip renders a few times a second at most.
   */
  currentBeat?: number
  /** The live clock, when rendering inside real gameplay -- drives the strip's scroll transform, so scrolling never triggers a React re-render. */
  beatPosition?: MotionValue<number>
  laneHeightPx: number
  /**
   * Height the pitch range is mapped onto, when it differs from the lane box
   * itself. The lowest pitch maps to exactly this Y, so with a bare
   * `laneHeightPx` a bottom note is drawn starting at the lane's bottom edge
   * and clipped away entirely; reserving one note's height keeps it visible.
   * Omitted keeps the original 1:1 behavior.
   */
  trackHeightPx?: number
  visibleBeatWindow?: number
  hitTiers?: Record<string, HitTier>
  /**
   * A scale computed elsewhere. When several players share one lane, every
   * layer must map pitch to Y identically -- so the caller computes one scale
   * across the whole chart and hands it to each layer. Omitted keeps the
   * original behavior: a scale auto-fitted to just these notes.
   */
  scale?: PitchRangeScale
  /**
   * This layer's singer, as their mic slot's rim colour.
   *
   * It is what a *cleared* note fills with -- published once per lane as the
   * `--ae-note-sung` custom property below and inherited by every note in it,
   * rather than written onto each of forty note elements at mount. Un-sung
   * notes are deliberately not tinted with it: see NoteBlock's KIND_FILL.
   */
  accentColor?: string
  /** Shifts the notes (not the clipping box) right, so "now" can sit inside the lane instead of on its left edge. */
  contentOffsetPercent?: number
  /** Pill thickness for this lane's notes -- see laneStack.noteHeightForLaneHeight. Omitted, the solo lane's size. */
  noteHeightPx?: number
  /**
   * Whose judgements clear this lane's notes.
   *
   * Every singer's lane draws the *same* chart, so a hit event has to be
   * matched to a lane or player 1 nailing a note would light it up in player
   * 4's lane too. Omitted, the lane finds its owner from the nearest
   * `[data-player-id]` ancestor (Gameplay's root carries one, and it wraps both
   * this lane and its burst layer) and falls back to clearing on any hit --
   * which is the right answer for a single-player lab or preview that has no
   * player identity at all.
   */
  playerId?: string
  /** Filled in at mount with the live-fill setter Gameplay's frame loop drives. */
  liveFillHandle?: MutableRefObject<LiveFillHandle | null>
}

/** The `data-cleared` value a judged note carries; `undefined` means still un-sung. */
type ClearedState = {
  tier: HitTier
  golden: boolean
  /**
   * How far along the pill the fill sweeps, 0..1 -- `judgeNote`'s partial
   * credit (see matching/noteCoverage.ts). A note the singer sang two thirds of
   * fills two thirds of the way and keeps the run; the empty third stays in the
   * un-sung grey, so the trail behind the playhead reads as *how well*, not
   * just *whether*.
   */
  fill: number
}

/** Below this a clear is drawn as partial: 1 - 0.005 is "the same pixels as full" at any pill width. */
const FULL_FILL_EPSILON = 0.005

/**
 * A missed note is not a zero-width fill.
 *
 * Its `::before` is what carries the dim un-filled wash the miss treatment is
 * drawn from (`.ae-note[data-cleared='awful']::before` in index.css), so
 * collapsing it to nothing would replace an established, deliberate look with
 * a bare outline. A miss is already unmistakable; partial fill is a statement
 * about notes that *earned* something.
 */
function fillFor(tier: HitTier, credit: number | undefined): number {
  if (tier === 'awful') return 1
  if (credit === undefined || !Number.isFinite(credit)) return 1
  return Math.min(1, Math.max(0, credit))
}

/**
 * The scrolling strip of notes.
 *
 * Every note sits at its own fixed `left` inside the strip, and the *strip* is
 * translated by `-beat * PX_PER_BEAT`. That is the whole scroll: one
 * compositor-only `transform` write per lane per frame, whether the lane has
 * three notes on screen or forty.
 *
 * Which notes are mounted is still plain beat-range culling, re-evaluated from
 * the throttled `currentBeat` about ten times a second -- no virtualization is
 * needed at chart note-count scale.
 *
 * ## Clearing a note
 *
 * The lane also *clears* its notes, which is the thing that makes singing feel
 * like it landed: a judged note fills in with the colour it earned, swells,
 * flashes, and stays lit behind the playhead. All of it is CSS
 * (`.ae-note` in index.css), triggered by writing three attributes on the
 * note's own element, and none of it costs a React render or a node:
 *
 *  - **The fill is partial.** How far it sweeps is `judgeNote`'s credit for
 *    that note, so a note two thirds sung fills two thirds of the way and the
 *    rest stays in the un-sung grey. It is one extra custom property on the
 *    same element -- the sweep, the swell and the flash are the same keyframes
 *    they always were, just aimed at a different end point.
 *  - **No render per hit.** The lane subscribes to `useHitStore` imperatively,
 *    exactly as LaneHitFx does. A judged note is `element.dataset.cleared =
 *    tier` -- not a state update, and certainly not a re-render of a strip
 *    holding forty note pills on each of eight lanes.
 *  - **No node per hit.** The fill and the flash are the note's own `::before`
 *    and `::after`, which exist for free. A song with ten thousand notes ends
 *    with the same node count it started with.
 *  - **No JS per frame.** `transform`/`opacity` keyframes only. The note's
 *    geometry (`left`/`top`/`width`/`height`) is still written exactly once, at
 *    mount, and never touched again -- clearing must not put layout back into
 *    the hot path it was removed from.
 *  - **No query per hit.** Note elements hand themselves to the lane through a
 *    stable ref callback at mount, so a hit is a Map lookup.
 */
export function NoteLane({
  notes,
  currentBeat,
  beatPosition,
  laneHeightPx,
  trackHeightPx,
  visibleBeatWindow = DEFAULT_VISIBLE_BEAT_WINDOW,
  hitTiers,
  scale: providedScale,
  accentColor,
  contentOffsetPercent = 0,
  noteHeightPx,
  playerId,
  liveFillHandle,
}: NoteLaneProps) {
  const reduceMotion = useReducedMotion() ?? false
  /**
   * Line paging (see linePaging.ts): when the lane this is drawn in pages,
   * only the line that is up is mounted, laid across the lane's width. Without
   * a paging context -- labs, tests, previews -- this is the scrolling strip.
   */
  const paging = useLanePaging()
  const pageIndex = useLanePageIndex(paging)
  const scale = providedScale ?? computePitchRangeScaleFromPitches(notes.map((note) => note.pitch))

  // The scrolling lane's own cull, for a live clock with no `currentBeat`: a
  // state that moves in CULL_STEP_BEATS steps, so following the clock costs a
  // render every few beats rather than one per frame.
  const [cullBeat, setCullBeat] = useState(() => currentBeat ?? beatPosition?.get() ?? 0)
  useEffect(() => {
    if (currentBeat !== undefined || !beatPosition || paging) return
    let step = Math.floor(beatPosition.get() / CULL_STEP_BEATS)
    setCullBeat(step * CULL_STEP_BEATS)
    return beatPosition.on('change', (beat) => {
      const next = Math.floor(beat / CULL_STEP_BEATS)
      if (next === step) return
      step = next
      setCullBeat(next * CULL_STEP_BEATS)
    })
  }, [currentBeat, beatPosition, paging])
  const effectiveBeat = currentBeat ?? cullBeat
  const visible = paging ? [] : notes.filter((note) => Math.abs(note.startBeat - effectiveBeat) <= visibleBeatWindow)

  const rootRef = useRef<HTMLDivElement | null>(null)
  /** Mounted note elements, by id. Only ever the visible window's worth. */
  const elementsRef = useRef(new Map<string, HTMLDivElement>())
  /**
   * What has already been cleared, so a note that scrolls out of the mounted
   * window and back in again (a seek, a resize, a lab scrubbing the beat) comes
   * back still cleared instead of silently un-singing itself. Keyed by the
   * `notes` array it was built for, so a new chart can never inherit the
   * previous one's judgements through a re-used note id.
   */
  const clearedRef = useRef<{ source: NoteWithId[]; map: Map<string, ClearedState> }>({
    source: notes,
    map: new Map(),
  })
  /** Resolved once per mount; see the `playerId` prop. */
  const ownerRef = useRef<string | null>(null)
  // Note id -> "is it golden", built once per chart. A judged note is looked
  // up thousands of times over a song; an O(n) scan of a 3,000-note chart per
  // hit per lane is the kind of incidental work this screen is not allowed.
  const goldenById = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const note of notes) map.set(note.noteId, isGoldenKind(note.kind))
    return map
  }, [notes])

  /**
   * A judgement handed in as a prop (labs, static previews, tests) rather than
   * heard from the hit store.
   *
   * Read through a ref written during render, so it is already current when
   * React invokes the note's ref callback in the same commit. Both paths end up
   * writing the same two attributes through `paintCleared`, which is the point:
   * the declarative preview and the live game cannot drift apart, because there
   * is only one thing that paints a cleared note.
   */
  const declaredRef = useRef<Record<string, HitTier> | undefined>(hitTiers)
  declaredRef.current = hitTiers

  const declaredClear = useCallback(
    (noteId: string): ClearedState | undefined => {
      const tier = declaredRef.current?.[noteId]
      if (!tier) return undefined
      return { tier, golden: (goldenById.get(noteId) ?? false) && tier !== 'awful', fill: 1 }
    },
    [goldenById],
  )

  /**
   * Writes a judgement onto a note's element. Two attributes and one custom
   * property; CSS does the rest.
   *
   * `--ae-note-fill` is deliberately a custom property rather than a
   * `transform`: the fill lives on the note's `::before`, which the stylesheet
   * animates and then rests at `scaleX(var(--ae-note-fill))`. Writing a
   * transform on the note element itself would put geometry back on the hot
   * path this lane exists to keep it off -- and would fight the swell keyframe
   * for the same property.
   */
  const paintCleared = useCallback((element: HTMLDivElement, state: ClearedState) => {
    element.dataset.cleared = state.tier
    element.dataset.clearedGolden = state.golden ? 'true' : 'false'
    element.style.setProperty('--ae-note-fill', String(state.fill))
    element.dataset.partial = state.fill < 1 - FULL_FILL_EPSILON ? 'true' : 'false'
    // The judged fill takes over from the live one.
    element.style.removeProperty('--ae-note-live')
  }, [])

  /** Drops judgements belonging to a chart that is no longer on screen. */
  const currentChart = useCallback(() => {
    if (clearedRef.current.source !== notes) clearedRef.current = { source: notes, map: new Map() }
    return clearedRef.current
  }, [notes])

  const registerElement = useCallback(
    (noteId: string, element: HTMLDivElement | null) => {
      if (element === null) {
        elementsRef.current.delete(noteId)
        return
      }
      // Checked here, not in an effect: React runs ref callbacks during the
      // commit and effects after it, so a new chart's very first notes would
      // otherwise be painted from the outgoing chart's judgements whenever the
      // two happen to share a note id.
      const store = currentChart()
      elementsRef.current.set(noteId, element)
      const known = store.map.get(noteId) ?? declaredClear(noteId)
      if (known) {
        paintCleared(element, known)
      } else {
        // React re-uses a DOM node whose key survives a chart swap, and it only
        // removes attributes *it* wrote -- so an un-sung note of the new chart
        // would come up still wearing the old chart's judgement.
        delete element.dataset.cleared
        delete element.dataset.clearedGolden
        delete element.dataset.partial
        element.style.removeProperty('--ae-note-fill')
      }
    },
    [paintCleared, currentChart, declaredClear],
  )

  // The frame loop's live fill (see NoteBlock). A Map lookup and one custom
  // property per write; a judged note is left to its judged fill.
  useEffect(() => {
    if (!liveFillHandle) return
    liveFillHandle.current = {
      set(noteId, fraction) {
        const element = elementsRef.current.get(noteId)
        if (!element || element.dataset.cleared) return
        element.style.setProperty('--ae-note-live', String(Math.min(1, Math.max(0, fraction))))
      },
    }
    const ref = liveFillHandle
    return () => {
      ref.current = null
    }
  }, [liveFillHandle])

  // The chart's golden notes, published for LaneHitFx -- which is handed a note
  // *id* by the hit store and has no other view of the chart. See
  // effects/noteKindRegistry.ts for why this is a table and not a store.
  useEffect(() => registerNoteKinds(notes), [notes])

  // A `hitTiers` prop that changes after mount (a lab stepping through a
  // chart). Costs nothing during a real song, where the prop is never passed.
  useEffect(() => {
    if (!hitTiers) return
    for (const noteId of Object.keys(hitTiers)) {
      const element = elementsRef.current.get(noteId)
      const state = declaredClear(noteId)
      if (element && state) paintCleared(element, state)
    }
  }, [hitTiers, declaredClear, paintCleared])

  useEffect(() => {
    ownerRef.current =
      playerId ?? rootRef.current?.closest('[data-player-id]')?.getAttribute('data-player-id') ?? null

    // Imperative, for the same reason LaneHitFx's subscription is: a judged
    // note must never re-render the strip above it.
    return useHitStore.subscribe((state, previous) => {
      const event: JudgedHit | null = state.latest
      if (!event || event === previous.latest) return
      const owner = ownerRef.current
      if (owner !== null && event.playerId !== owner) return

      const golden = goldenById.get(event.noteId)
      if (golden === undefined) return // a hit for some other chart's note
      const store = currentChart()
      if (store.map.has(event.noteId)) return

      // A golden note that was *missed* is still a miss: it keeps the miss's
      // treatment, exactly as LaneHitFx keeps the miss's word and sound.
      const cleared: ClearedState = {
        tier: event.tier,
        golden: golden && event.tier !== 'awful',
        fill: fillFor(event.tier, event.credit),
      }
      store.map.set(event.noteId, cleared)
      const element = elementsRef.current.get(event.noteId)
      if (element) paintCleared(element, cleared)
    })
  }, [goldenById, paintCleared, playerId, currentChart])

  // A stable fallback source so useTransform always has a MotionValue input
  // (rules-of-hooks: it can't be called conditionally) when no live clock is
  // given -- labs and static previews position from the plain number.
  const fallbackBeat = useMemo(() => motionValue(effectiveBeat), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!beatPosition) fallbackBeat.set(effectiveBeat)
  }, [beatPosition, effectiveBeat, fallbackBeat])

  const scrollX = useTransform(beatPosition ?? fallbackBeat, (beat) => -beat * PX_PER_BEAT)

  /**
   * The page that is up, as one memoised strip keyed by its index: a flip
   * mounts the new line's notes once (fading in) and nothing re-renders
   * between flips. Clearing is untouched -- the notes hand themselves to
   * `registerElement` exactly as the scrolling strip's do, so a note that was
   * judged is painted cleared when its page comes back.
   */
  const trackHeight = trackHeightPx ?? laneHeightPx
  const page = paging && pageIndex >= 0 ? paging.paging.pages[pageIndex] : undefined
  const pageStrip = useMemo(() => {
    if (!page) return null
    return (
      <motion.div
        key={page.index}
        data-testid="note-page"
        data-page-index={page.index}
        className="absolute inset-0"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        {page.notes.map((note) => (
          <NoteBlock
            key={note.noteId}
            note={note}
            scale={page.scale}
            laneHeightPx={trackHeight}
            hitTier={hitTiers?.[note.noteId]}
            heightPx={noteHeightPx}
            onElement={registerElement}
            layout={noteLayoutOnPage(page, note)}
          />
        ))}
      </motion.div>
    )
  }, [page, reduceMotion, trackHeight, hitTiers, noteHeightPx, registerElement])

  return (
    <div
      ref={rootRef}
      className="ae-lane relative w-full"
      style={{
        height: `${laneHeightPx}px`,
        overflow: 'hidden',
        // The clear's palette, declared once per lane and inherited by every
        // note in it -- rather than three custom properties written onto each
        // of forty note elements at mount.
        ['--ae-note-epic' as string]: TIER_COLOR.epic,
        ['--ae-note-good' as string]: TIER_COLOR.good,
        ['--ae-note-awful' as string]: TIER_COLOR.awful,
        ['--ae-note-golden' as string]: GOLDEN_COLOR,
        // What a landed note fills with. The reference frame's sung notes are
        // the *singer's* colour, not a judgement colour -- which is what makes
        // the trail behind the playhead readable as "these are mine" from
        // across a room. The tier is still on screen, in the burst's word and
        // in how hard the fill glows (see `.ae-note[data-cleared]` in
        // index.css); it is no longer the only thing the note says. Falls back
        // to the epic colour when no singer owns this lane (labs, previews).
        ['--ae-note-sung' as string]: accentColor ?? TIER_COLOR.epic,
      }}
      data-testid="note-lane"
      data-note-count={notes.length}
      data-paged={paging ? 'true' : 'false'}
      // Reduce Motion replaces the clear's animation, never slows it: the note
      // still fills in and still keeps its tier colour, it just does not sweep,
      // swell or flash. See `.ae-note` in index.css.
      data-static={reduceMotion ? 'true' : 'false'}
    >
      {paging ? (
        pageStrip
      ) : (
      <div
        className="absolute inset-0"
        style={contentOffsetPercent ? { transform: `translateX(${contentOffsetPercent}%)` } : undefined}
      >
        <motion.div
          data-testid="note-strip"
          className="absolute inset-0"
          // Promoted deliberately: this and the pitch line are the only two
          // elements in the lane that move, so they are the only two worth a
          // compositor layer -- `will-change` holds VRAM for as long as the
          // element exists, which is the whole song.
          //
          // `translateZ(0)` is appended for the same reason it is on PitchLine:
          // framer-motion emits a bare `translateX()` for a single-axis motion
          // value, which leaves the element on the 2D path.
          transformTemplate={forceCompositeLayer}
          style={{ x: scrollX, willChange: 'transform' }}
        >
          {visible.map((note) => (
            <NoteBlock
              key={note.noteId}
              note={note}
              scale={scale}
              laneHeightPx={trackHeightPx ?? laneHeightPx}
              hitTier={hitTiers?.[note.noteId]}
              heightPx={noteHeightPx}
              onElement={registerElement}
            />
          ))}
        </motion.div>
      </div>
      )}
    </div>
  )
}

export { NOTE_HEIGHT_PX, PX_PER_BEAT }
