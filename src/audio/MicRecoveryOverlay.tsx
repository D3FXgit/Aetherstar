import { useEffect, useId, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { glassSurfaceClass, solidSurfaceClass, tokens } from '../design/tokens'
import { GlassButton } from '../design/primitives/GlassButton'
import { useSceneStore, type SceneName } from '../scenes/sceneStore'
import { useT, type TFunction } from '../i18n'
import { useMicRecoveryStore, type LostInput } from './micRecoveryStore'

/**
 * The scenes where a song is actually running. Kept here rather than imported
 * from App.tsx (which renders this component, so the import would be circular);
 * it mirrors App's own GAMEPLAY_SCENES.
 */
const SONG_IN_PROGRESS_SCENES: ReadonlySet<SceneName> = new Set<SceneName>(['session-play'])

/** "Mic 3", in the current language. */
function micName(t: TFunction, input: LostInput): string {
  return t('mic.slot', { number: String(input.micNumber) })
}

// State the fact plainly and say how to fix it: no "oops", no blame.
function titleFor(t: TFunction, lostInputs: LostInput[]): string {
  if (lostInputs.length === 1) return t('micRecovery.title.single', { mic: micName(t, lostInputs[0]!) })
  return t('micRecovery.title.several', { count: lostInputs.length })
}

function guidanceFor(t: TFunction, lostInputs: LostInput[]): string {
  if (lostInputs.length === 1) return t('micRecovery.guidance.single', { mic: micName(t, lostInputs[0]!) })
  return t('micRecovery.guidance.several')
}

function dismissLabelFor(t: TFunction, lostInputs: LostInput[]): string {
  if (lostInputs.length === 1) return t('micRecovery.dismiss.single', { mic: micName(t, lostInputs[0]!) })
  return t('micRecovery.dismiss.several')
}

function LostList({ id, lostInputs }: { id: string; lostInputs: LostInput[] }) {
  const t = useT()
  return (
    <ul id={id} className="mt-3 flex flex-col gap-1">
      {lostInputs.map((input) => (
        <li
          key={input.captureKey}
          data-testid={`mic-recovery-lost-${input.captureKey}`}
          className="flex flex-wrap items-baseline justify-center gap-x-2 text-base"
        >
          {/* The mic number is the identity; the player (absent when nobody
              holds the mic) says who to hand it to; the hardware name says
              which cable to check. All words, nothing carried by colour alone. */}
          <span className="font-semibold text-ink-primary">{micName(t, input)}</span>
          {input.playerName ? <span className="text-ink-secondary">{input.playerName}</span> : null}
          <span className="text-ink-secondary">{input.deviceName}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Recovery UI for a mic unplugged mid-party. Mid-song it is a non-modal glass
 * banner over the video (no focus, no Escape, the song goes on for everyone
 * else); anywhere else it is a modal alert, the cheapest moment to fix it.
 * Plugging the mic back into the same port restores it with no interaction.
 */
export function MicRecoveryOverlay() {
  const lostInputs = useMicRecoveryStore((state) => state.lostInputs)
  const dismissed = useMicRecoveryStore((state) => state.dismissed)
  const dismiss = useMicRecoveryStore((state) => state.dismiss)
  const scene = useSceneStore((state) => state.current)
  const reduceMotion = useReducedMotion()
  const t = useT()
  const titleId = useId()
  const listId = useId()
  const guidanceId = useId()
  const dismissRef = useRef<HTMLButtonElement>(null)

  const open = lostInputs.length > 0 && !dismissed
  const midSong = SONG_IN_PROGRESS_SCENES.has(scene)
  const modal = open && !midSong

  useEffect(() => {
    if (!modal) return
    // The safe default: the choice that puts the user back where they were.
    dismissRef.current?.focus()
  }, [modal])

  useEffect(() => {
    if (!modal) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture + stopPropagation, exactly as GlassConfirmDialog does it, so
      // the shell's Escape-is-Back listener does not also pop a layer. The
      // banner variant installs none of this: mid-song, Escape must still
      // reach App's abandon-song prompt.
      event.stopPropagation()
      event.preventDefault()
      dismiss()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [modal, dismiss])

  const body = (
    <>
      <h2 id={titleId} className={modal ? 'text-2xl font-bold text-ink-primary' : 'text-lg font-semibold text-ink-primary'}>
        {titleFor(t, lostInputs)}
      </h2>
      <LostList id={listId} lostInputs={lostInputs} />
      <p id={guidanceId} data-testid="mic-recovery-guidance" className="mt-3 text-base text-ink-secondary">
        {guidanceFor(t, lostInputs)}
      </p>
      <div className={`flex flex-wrap items-center justify-center gap-3 ${modal ? 'mt-8' : 'mt-4'}`}>
        <GlassButton
          ref={dismissRef}
          type="button"
          variant={modal ? 'primary' : 'glass'}
          sfx="back"
          onClick={dismiss}
          className="px-6 py-2 text-base font-semibold"
        >
          {dismissLabelFor(t, lostInputs)}
        </GlassButton>
        {/* Reassigning means leaving for another screen, which mid-song would
            abandon the song for everyone. */}
        {modal && (
          <GlassButton
            type="button"
            sfx="confirm"
            onClick={() => {
              dismiss()
              useSceneStore.getState().navigate('hardware-setup')
            }}
            className="px-6 py-2 text-base"
          >
            {t('micRecovery.openSetup')}
          </GlassButton>
        )}
      </div>
    </>
  )

  return (
    <AnimatePresence>
      {open &&
        (modal ? (
          <motion.div
            key="mic-recovery-modal"
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              // Who was lost *and* what to do about it: the announcement is
              // useless without both halves.
              aria-describedby={`${listId} ${guidanceId}`}
              data-focus-scope
              data-testid="mic-recovery"
              className={`${solidSurfaceClass()} mx-6 w-full max-w-lg rounded-3xl p-8 text-center`}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94 }}
              transition={reduceMotion ? { duration: 0 } : tokens.spring.panelEnter}
            >
              {body}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="mic-recovery-banner"
            role="alert"
            data-testid="mic-recovery"
            // Top-centre, clear of the lyric box and pitch lane the singers are
            // reading. Glass, because it floats over the playing video.
            // `pointer-events-auto` on a layer that does not cover the stage
            // keeps the rest of gameplay clickable.
            className={`${glassSurfaceClass()} pointer-events-auto fixed left-1/2 top-6 z-[95] w-[min(34rem,calc(100vw-3rem))] -translate-x-1/2 rounded-2xl px-6 py-4 text-center shadow-2xl`}
            initial={reduceMotion ? false : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -12 }}
            transition={reduceMotion ? { duration: 0 } : tokens.spring.panelEnter}
          >
            {body}
          </motion.div>
        ))}
    </AnimatePresence>
  )
}
