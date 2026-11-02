import { useEffect, useId, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { solidSurfaceClass, tokens } from '../tokens'
import { useT } from '../../i18n'
import { GlassButton } from './GlassButton'

interface GlassConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  /** Tints the confirm button coral, for actions that throw work away. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The app's confirmation modal (never the native `confirm()`, which a gamepad
 * cannot reach). Directional focus is confined to it (`data-focus-scope`),
 * Cancel takes focus as the safe default, and Escape cancels without also
 * reaching the shell's Back handler.
 */
export function GlassConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: GlassConfirmDialogProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const titleId = useId()
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture phase + stopPropagation: the shell's Escape-is-Back must not also run.
      event.stopPropagation()
      event.preventDefault()
      onCancelRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={messageId}
            data-focus-scope
            data-testid="confirm-dialog"
            className={`${solidSurfaceClass()} mx-6 w-full max-w-md rounded-3xl p-8 text-center shadow-2xl`}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94 }}
            transition={reduceMotion ? { duration: 0 } : tokens.spring.panelEnter}
          >
            <h2 id={titleId} className="text-2xl font-bold">
              {title}
            </h2>
            <p id={messageId} className="mt-3 text-ink-secondary">
              {message}
            </p>
            <div className="mt-8 flex items-center justify-center gap-4">
              <GlassButton ref={cancelRef} type="button" sfx="back" onClick={onCancel} className="px-8">
                {cancelLabel ?? t('ui.dialog.cancel')}
              </GlassButton>
              <GlassButton
                type="button"
                sfx="confirm"
                onClick={onConfirm}
                variant={destructive ? 'danger' : 'primary'}
                className="px-8"
              >
                {confirmLabel}
              </GlassButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
