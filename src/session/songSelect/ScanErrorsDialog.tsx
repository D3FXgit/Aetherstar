// "N songs couldn't be loaded": a quiet header button and the list behind it.
import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useSfx } from '../../audio/useSfx'
import type { ScanErrorEntry } from '../../library/types'
import { interceptSessionBack } from '../sessionStore'
import { SURFACE, TEXT, u } from './layout'

export function ScanErrorsButton({ errors }: { errors: ScanErrorEntry[] }) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  if (errors.length === 0 && !open) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          playSfx('click')
          setOpen(true)
        }}
        aria-haspopup="dialog"
        className="transition-colors duration-150 hover:text-[var(--ae-text-secondary)]"
        style={{ fontSize: u(17), color: TEXT.tertiary, textDecoration: 'underline', textUnderlineOffset: u(4) }}
        data-testid="scan-errors-button"
      >
        {t('songSelect.scanErrors.button', { count: errors.length })}
      </button>
      {open && (
        <ScanErrorsDialog
          errors={errors}
          onClose={() => {
            playSfx('back')
            setOpen(false)
            // Focus goes back where it came from, so the stick is not left nowhere.
            requestAnimationFrame(() => buttonRef.current?.focus())
          }}
        />
      )}
    </>
  )
}

function ScanErrorsDialog({ errors, onClose }: { errors: ScanErrorEntry[]; onClose: () => void }) {
  const t = useT()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    closeRef.current?.focus()
    // Captured, so the shell's Escape-is-Back never also fires.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    // Gamepad B and Backspace reach the session's Back; close instead of leaving the screen.
    const release = interceptSessionBack(() => {
      onCloseRef.current()
      return true
    })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      release()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-focus-scope
        data-testid="scan-errors-dialog"
        className="flex flex-col"
        style={{
          width: `min(92vw, ${u(900)})`,
          maxHeight: '80vh',
          padding: u(32),
          gap: u(20),
          borderRadius: u(24),
          background: SURFACE.panel,
          border: `1px solid ${SURFACE.line}`,
        }}
      >
        <div className="flex flex-col" style={{ gap: u(6) }}>
          <h2 id={titleId} style={{ fontSize: u(30), fontWeight: 700, color: TEXT.primary }}>
            {t('songSelect.scanErrors.title')}
          </h2>
          <p style={{ fontSize: u(18), color: TEXT.secondary }}>{t('songSelect.scanErrors.description')}</p>
        </div>
        <ul className="flex min-h-0 flex-col overflow-y-auto" style={{ gap: u(10) }}>
          {errors.map((error, index) => (
            <li
              key={`${error.path}#${index}`}
              className="flex flex-col"
              style={{ padding: `${u(12)} ${u(16)}`, borderRadius: u(12), background: SURFACE.raised, gap: u(4) }}
              data-testid="scan-error"
            >
              <span className="break-all" style={{ fontSize: u(17), fontWeight: 600, color: TEXT.primary }}>
                {error.path}
              </span>
              <span style={{ fontSize: u(16), color: TEXT.secondary }}>{error.reason}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="transition-colors duration-150 hover:bg-[var(--ae-surface-hover,#2a2638)]"
            style={{
              padding: `${u(12)} ${u(28)}`,
              borderRadius: '999px',
              fontSize: u(18),
              fontWeight: 600,
              background: SURFACE.raised,
              border: `1px solid ${SURFACE.line}`,
              color: TEXT.primary,
            }}
          >
            {t('songSelect.scanErrors.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
