import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes } from 'react'
import { useSfx } from '../../audio/useSfx'
import type { SfxName } from '../../audio/sfxContract'
import { useT } from '../../i18n'
import { useSessionStore } from '../../session/sessionStore'
import { usePauseStore } from './pauseStore'
import { quitSong } from './quitSong'
import { usePauseGamepadStart } from './usePauseGamepadStart'

/**
 * The pause menu and its 3-2-1 resume lead-in, drawn over the song.
 *
 * Mounted by the shell for the whole song screen rather than by the stage, so
 * Back still has somewhere to go while a song loads or after its scene crashed.
 * Back (Escape, Backspace, pad B) and pad Start all toggle it via the store.
 */
export function PauseLayer({ enabled = true }: { enabled?: boolean }) {
  const phase = usePauseStore((state) => state.phase)
  const resumeCountdown = usePauseStore((state) => state.resumeCountdown)

  usePauseGamepadStart(() => usePauseStore.getState().toggle(), enabled)

  if (!enabled) return null
  if (phase === 'menu') return <PauseMenu />
  if (phase === 'resuming' && resumeCountdown !== null) return <ResumeLeadIn seconds={resumeCountdown} />
  return null
}

function PauseMenu() {
  const t = useT()
  const titleId = useId()
  const resumeRef = useRef<HTMLButtonElement>(null)
  const song = useSessionStore((state) => state.selectedSong)
  const partyMode = useSessionStore((state) => state.mode === 'party')

  useEffect(() => {
    resumeRef.current?.focus()
  }, [])

  return (
    // A static, paused frame sits behind this, so the blur costs one pass, not one per frame.
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-[8px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-focus-scope
        data-testid="pause-menu"
        className="mx-6 w-full max-w-md rounded-3xl border border-white/10 bg-[#0e0e14]/95 p-8"
      >
        <h2 id={titleId} className="text-3xl font-bold text-[var(--ae-text-primary)]">
          {t('sing.pause.title')}
        </h2>
        {song && (
          <p data-testid="pause-menu-song" className="mt-2 truncate text-lg text-[var(--ae-text-secondary)]">
            {t('sing.pause.song', { title: song.title, artist: song.artist })}
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3">
          <PauseButton ref={resumeRef} primary sfx="confirm" onClick={() => usePauseStore.getState().resume()}>
            {t('sing.pause.resume')}
          </PauseButton>
          <PauseButton onClick={() => usePauseStore.getState().restart()}>{t('sing.pause.restart')}</PauseButton>
          <PauseButton sfx="back" onClick={quitSong}>
            {partyMode ? t('sing.pause.quitParty') : t('sing.pause.quit')}
          </PauseButton>
        </div>
      </div>
    </div>
  )
}

interface PauseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean
  sfx?: SfxName
}

/** Solid, full-width, big type: read and hit from the sofa. Focus uses the app's couch ring. */
const PauseButton = forwardRef<HTMLButtonElement, PauseButtonProps>(function PauseButton(
  { primary = false, sfx = 'click', className, onClick, children, ...rest },
  ref,
) {
  const playSfx = useSfx((state) => state.play)
  const look = primary
    ? 'bg-[var(--ae-text-primary)] text-[#0b0b10] hover:bg-white'
    : 'border border-white/10 bg-white/[0.08] text-[var(--ae-text-primary)] hover:bg-white/[0.14]'
  return (
    <button
      ref={ref}
      type="button"
      className={`w-full rounded-2xl px-6 py-4 text-left text-xl font-semibold transition-colors ${look} ${className ?? ''}`}
      onClick={(event) => {
        playSfx(sfx)
        onClick?.(event)
      }}
      {...rest}
    >
      {children}
    </button>
  )
})

function ResumeLeadIn({ seconds }: { seconds: number }) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)

  useEffect(() => {
    playSfx('countdownBeep')
  }, [seconds, playSfx])

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center">
      <div
        data-testid="pause-resume-countdown"
        role="timer"
        aria-live="off"
        className="rounded-[28px] border border-white/15 bg-black/70 px-12 py-6 text-center"
      >
        <div className="text-7xl font-bold tabular-nums text-[var(--ae-text-primary)]">{seconds}</div>
        <div className="mt-1 text-lg font-medium text-[var(--ae-text-secondary)]">{t('sing.pause.getReady')}</div>
      </div>
    </div>
  )
}
