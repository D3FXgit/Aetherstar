// The small menu Back opens over a jukebox song: keep listening, skip, or leave.
import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n'
import { useSfx } from '../audio/useSfx'
import { useSessionStore } from '../session/sessionStore'
import { resumeJukebox } from './transport'

const buttonClass =
  'w-full rounded-2xl border border-[var(--ae-line,rgba(255,255,255,0.09))] bg-[var(--ae-surface-raised,#1f1c2a)] px-6 py-4 text-left text-xl font-semibold text-[var(--ae-text-primary)] transition-colors duration-150 hover:bg-[var(--ae-surface-hover,#2a2638)]'

export function JukeboxMenu() {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  const titleId = useId()
  const firstRef = useRef<HTMLButtonElement>(null)

  // "Keep listening" means just that: a paused song plays on.
  const close = () => {
    playSfx('back')
    useSessionStore.getState().setJukeboxMenuOpen(false)
    resumeJukebox()
  }

  useEffect(() => {
    firstRef.current?.focus()
    // Captured, so the shell's Escape-is-Back does not reopen it at once.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      useSfx.getState().play('back')
      useSessionStore.getState().setJukeboxMenuOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-focus-scope
        data-testid="jukebox-menu"
        className="flex w-full max-w-sm flex-col gap-3 rounded-3xl border border-[var(--ae-line,rgba(255,255,255,0.09))] bg-[var(--ae-surface-panel,#15131d)] p-6"
      >
        <h2 id={titleId} className="mb-2 text-2xl font-bold text-[var(--ae-text-primary)]">
          {t('jukebox.menu.title')}
        </h2>
        <button ref={firstRef} type="button" className={buttonClass} onClick={close}>
          {t('jukebox.menu.resume')}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            playSfx('confirm')
            useSessionStore.getState().nextJukeboxSong()
          }}
        >
          {t('jukebox.menu.skip')}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            playSfx('back')
            useSessionStore.getState().jukeboxBackToList()
          }}
        >
          {t('jukebox.menu.backToList')}
        </button>
      </div>
    </div>
  )
}
