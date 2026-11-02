import { GlassButton } from './GlassButton'
import { GlassPanel } from './GlassPanel'
import { NeonText } from './NeonText'
import { useT } from '../../i18n'

interface GlassErrorStateProps {
  title: string
  message: string
  accent?: 'coral' | 'cyan' | 'gold'
  retryLabel?: string
  onRetry?: () => void
  actionLabel?: string
  onAction?: () => void
  /** Technical detail for whoever is debugging, kept behind a "Show details" disclosure. */
  details?: string
}

/** The shared "never a white screen" panel: a title, one plain sentence, and a way forward. */
export function GlassErrorState({
  title,
  message,
  accent = 'coral',
  retryLabel,
  onRetry,
  actionLabel,
  onAction,
  details,
}: GlassErrorStateProps) {
  const t = useT()
  const hasButtons = Boolean((retryLabel && onRetry) || (actionLabel && onAction))

  return (
    <GlassPanel className="p-8 m-auto max-w-md text-center flex flex-col gap-4" data-testid="glass-error-state">
      <NeonText accent={accent} className="text-xl font-bold">
        {title}
      </NeonText>
      <p className="text-base text-ink-secondary">{message}</p>
      {hasButtons && (
        <div className="flex items-center justify-center gap-3">
          {retryLabel && onRetry && (
            <GlassButton type="button" variant="primary" onClick={onRetry} className="px-6 font-semibold">
              {retryLabel}
            </GlassButton>
          )}
          {actionLabel && onAction && (
            <GlassButton type="button" onClick={onAction} className="px-6 font-semibold">
              {actionLabel}
            </GlassButton>
          )}
        </div>
      )}
      {details && (
        <details className="text-left text-xs text-ink-tertiary" data-testid="glass-error-details">
          <summary className="cursor-pointer select-none text-center text-ink-secondary">{t('ui.error.showDetails')}</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">{details}</pre>
        </details>
      )}
    </GlassPanel>
  )
}
