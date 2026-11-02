import { Component, type ErrorInfo, type ReactNode } from 'react'
import { GlassErrorState } from './GlassErrorState'
import { useSceneStore } from '../../scenes/sceneStore'
import { CRASH_PREFIX, logCrash } from '../../diagnostics/log'
import { t } from '../../i18n'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Where this boundary sits, for the crash log (e.g. "app-shell", "scene:session-play"). */
  label: string
  /** Changing this clears a caught error; pass the scene name so navigating away recovers. */
  resetKey?: string | number
  title?: string
  /** Overrides the default "navigate back to Home" recovery (labs/tests). */
  onRecover?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
  lastResetKey: string | number | undefined
}

/**
 * The "never a white screen" net: catches a render-phase throw, logs the error
 * and component stack under `[AetherStar crash]`, and keeps a way out on
 * screen. A class because error boundaries have no hook equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, componentStack: null, lastResetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey === state.lastResetKey) return null
    return { error: null, componentStack: null, lastResetKey: props.resetKey }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ componentStack: errorInfo.componentStack ?? null })
    logCrash(this.props.label, error, { componentStack: errorInfo.componentStack ?? '(none)' })
  }

  private handleRecover = (): void => {
    this.setState({ error: null, componentStack: null })
    if (this.props.onRecover) {
      this.props.onRecover()
      return
    }
    useSceneStore.getState().navigate('home')
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen w-full" data-testid="error-boundary-fallback" data-error-boundary={this.props.label}>
        <GlassErrorState
          title={this.props.title ?? t('ui.error.title')}
          message={t('ui.error.message')}
          retryLabel={t('ui.error.retry')}
          onRetry={this.handleRecover}
          details={`${error.name}: ${error.message}

${t('ui.error.logged', { prefix: CRASH_PREFIX })}`}
        />
      </div>
    )
  }
}
