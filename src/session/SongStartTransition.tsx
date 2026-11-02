// `starting` phase: the zoom between "who's singing" and the song, timed to
// song_selected.wav, with a 3-2-1 countdown over its last three seconds. The
// cover leads, then recedes behind the numeral: during a countdown exactly one
// thing may be the loudest element on screen.
import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useSfx } from '../audio/useSfx'
import type { SfxHandle, SfxName } from '../audio/sfxContract'
import { SONG_SELECTED_DURATION_MS } from '../audio/sfxAssets'
import { springTransition } from '../design/tokens'
import { formatOklch } from '../design/palette/oklch'
import { DEFAULT_AMBIENT_PALETTE, type AmbientPalette } from '../design/palette/dominantColor'
import { useCoverPalette } from '../design/palette/useCoverPalette'
import type { ImagePixelSampler } from '../design/palette/imagePixelSampler'
import { useT } from '../i18n'
import { SESSION_COLORS, TEXT, displayType } from './sessionTheme'

/** The countdown occupies the last 3s of the transition: "3" at T-3000, "2" at T-2000, "1" at T-1000. */
const COUNTDOWN_STEPS = [3, 2, 1] as const
const COUNTDOWN_STEP_MS = 1000
const COUNTDOWN_TOTAL_MS = COUNTDOWN_STEPS.length * COUNTDOWN_STEP_MS

/** The near light: the big radial rushing toward the viewer. */
function nearLight(palette: AmbientPalette): string {
  return `radial-gradient(50% 50% at 50% 50%, ${formatOklch(palette.primary)} 0%, transparent 65%)`
}

/** The far light: smaller, brighter, hue-offset, laid over the near one at low alpha to give the frame depth. */
function farLight(palette: AmbientPalette): string {
  return `radial-gradient(35% 35% at 50% 50%, ${formatOklch(palette.secondary, 0.35)} 0%, transparent 70%)`
}

interface SongStartTransitionProps {
  songTitle?: string
  artist?: string
  /** Already-resolved media URL for the album art (see SessionStarting), or undefined when the song has none. */
  coverUrl?: string
  /** Fired once, when the transition (zoom + countdown) has fully run. */
  onComplete: () => void
  /** Overridable so tests don't wait ~5 real seconds. */
  durationMs?: number
  /** Canvas seam for dominant-colour extraction; injected in tests, since jsdom has no 2d context. */
  paletteSampler?: ImagePixelSampler
}

export function SongStartTransition({
  songTitle,
  artist,
  coverUrl,
  onComplete,
  durationMs = SONG_SELECTED_DURATION_MS,
  paletteSampler,
}: SongStartTransitionProps) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  const reduceMotion = useReducedMotion() ?? false
  const [count, setCount] = useState<number | null>(null)
  const [coverBroken, setCoverBroken] = useState(false)

  // Best effort, off the critical path: null (the default gradient) whenever the cover gives no usable colour.
  const coverPalette = useCoverPalette(coverUrl, paletteSampler)

  const showCover = Boolean(coverUrl) && !coverBroken
  const inCountdown = count !== null
  const spring = springTransition('tvOS', reduceMotion)

  // Each scaling carrier is promoted to its own layer so it is rasterised once
  // and only transformed afterwards; unpromoted, the full-screen gradients were
  // re-rastered every frame (~260 dropped frames per run, profiled at DPR 2).
  // Not under Reduce Motion, where nothing transforms and a layer buys nothing.
  const promoteTransform = reduceMotion ? undefined : 'transform'

  // The timed sequence. Every sound it starts is stopped by the cleanup, so
  // backing out (or StrictMode's double mount) never leaves the transition
  // audio playing over the next screen.
  useEffect(() => {
    // `playSfx` may be a stand-in that returns nothing (Dev Lab, tests); that must not crash the cleanup.
    const playing: SfxHandle[] = []
    const start = (name: SfxName) => {
      const handle: SfxHandle | void = playSfx(name)
      if (handle) playing.push(handle)
    }

    start('songSelected')

    const countdownStartMs = Math.max(durationMs - COUNTDOWN_TOTAL_MS, 0)
    const stepMs = COUNTDOWN_TOTAL_MS / COUNTDOWN_STEPS.length

    const timers = COUNTDOWN_STEPS.map((value, index) =>
      setTimeout(() => {
        setCount(value)
        start('countdownBeep')
      }, countdownStartMs + index * stepMs),
    )

    const finish = setTimeout(() => {
      // Not tracked: the unmount that follows at once would cancel the "go".
      playSfx('countdownGo')
      onComplete()
    }, durationMs)

    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(finish)
      playing.forEach((handle) => handle.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run the whole timed sequence exactly once per mount
  }, [])

  // Reduced motion: the sustained zoom becomes a plain fade to the same end
  // state. The timers above keep their timing either way.
  const zoom = (from: number, to: number, opacity: number | number[]) =>
    reduceMotion
      ? { initial: { opacity: 0 }, animate: { opacity: Array.isArray(opacity) ? opacity[opacity.length - 1] : opacity }, transition: { duration: 0.4 } }
      : {
          initial: { scale: from, opacity: 0.35 },
          animate: { scale: to, opacity },
          transition: { duration: durationMs / 1000, ease: 'easeIn' as const },
        }

  // Each light is drawn twice (default and cover palette) and cross-dissolved
  // inside the zoom carrier: gradients cannot be interpolated, and two separately
  // animating layers would sit at different points of the zoom.
  const ambientLayer = (light: (p: AmbientPalette) => string, testId: string) => (
    <>
      <motion.div
        data-testid={`ambient-default-${testId}`}
        className="absolute inset-0"
        style={{ background: light(DEFAULT_AMBIENT_PALETTE) }}
        animate={{ opacity: coverPalette ? 0 : 1 }}
        transition={spring}
      />
      {coverPalette && (
        <motion.div
          data-testid={`ambient-cover-${testId}`}
          className="absolute inset-0"
          style={{ background: light(coverPalette) }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={spring}
        />
      )}
    </>
  )

  return (
    <div
      // Named and modal, so a screen reader reports the change of context.
      role="dialog"
      aria-modal="true"
      aria-label={songTitle ? t('starting.label', { title: songTitle }) : t('starting.untitled')}
      className="relative flex h-screen w-full items-center justify-center overflow-hidden text-center"
      style={{ background: SESSION_COLORS.ground }}
      data-testid="song-start-transition"
    >
      <motion.div
        data-testid="ambient-zoom-near"
        className="pointer-events-none absolute inset-0"
        style={{ willChange: promoteTransform }}
        {...zoom(0.35, 2.4, 0.9)}
      >
        {ambientLayer(nearLight, 'near')}
      </motion.div>
      <motion.div
        data-testid="ambient-zoom-far"
        className="pointer-events-none absolute inset-0"
        style={{ willChange: promoteTransform }}
        {...zoom(0.2, 3.2, [0, 0.7, 0.2])}
      >
        {ambientLayer(farLight, 'far')}
      </motion.div>

      {/* Mounted for the screen's whole life: many screen readers only announce a change within a region. */}
      <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="transition-announcer">
        {inCountdown
          ? t('starting.countdown', { count: count ?? 0 })
          : songTitle
            ? artist
              ? t('starting.labelWithArtist', { title: songTitle, artist })
              : t('starting.label', { title: songTitle })
            : t('starting.untitled')}
      </div>

      <motion.div
        data-testid="transition-artwork"
        data-stage={inCountdown ? 'receded' : 'front'}
        className="relative z-10 flex flex-col items-center gap-5 px-8"
        // Promoted for the same reason as the lights: scale-springing a rounded
        // cover was the costliest raster path on this screen.
        style={{ willChange: promoteTransform }}
        initial={{ scale: 0.86, opacity: 0 }}
        // .45 keeps the title above 3:1 on the dark ground behind the numeral.
        animate={inCountdown ? { scale: 0.7, opacity: 0.45 } : { scale: 1, opacity: 1 }}
        transition={spring}
      >
        {showCover && (
          <img
            data-testid="transition-cover"
            src={coverUrl}
            // Decorative: the title and artist are right beneath it.
            alt=""
            decoding="async"
            onError={() => setCoverBroken(true)}
            className="h-[min(38vh,340px)] w-[min(38vh,340px)] rounded-[28px] object-cover"
          />
        )}

        {songTitle && (
          <h1
            className="max-w-[18ch]"
            style={displayType(64, { fontSize: 'clamp(2.25rem, 6vh, 4rem)' })}
            data-testid="transition-song-title"
          >
            {songTitle}
          </h1>
        )}
        {artist && (
          <p className="text-2xl" style={{ fontWeight: 700, color: TEXT.secondary }}>
            {artist}
          </p>
        )}
      </motion.div>

      {inCountdown && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <motion.p
            key={count}
            data-testid="transition-countdown"
            // Spoken by the live region above; reading the glyph too would say every step twice.
            aria-hidden="true"
            style={displayType(200, { fontSize: 'clamp(120px, 22vh, 220px)', lineHeight: 1, color: TEXT.primary })}
            initial={{ scale: reduceMotion ? 1 : 2.2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
          >
            {count}
          </motion.p>
        </div>
      )}

      {/* The visible way out: Back (bound globally) returns to the assign screen. */}
      <motion.p
        data-testid="transition-cancel-hint"
        className="absolute bottom-10 left-0 right-0 z-10 text-lg"
        style={{ fontWeight: 600, color: TEXT.secondary }}
        animate={{ opacity: inCountdown ? 0 : 1 }}
        transition={spring}
      >
        {t('starting.cancelHint')}
      </motion.p>
    </div>
  )
}
