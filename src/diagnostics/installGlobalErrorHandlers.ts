import { logCrash } from './log'

/**
 * Error boundaries only see render throws; unhandled rejections and stray
 * window errors would otherwise vanish in a packaged build. Route both into
 * the same crash channel the boundary uses.
 */
let installed = false

export function installGlobalErrorHandlers(target: Window = window): () => void {
  if (installed) return () => {}
  installed = true

  const onUnhandledRejection = (event: Event) => {
    const { reason } = event as Event & { reason?: unknown }
    logCrash('unhandledrejection', reason)
  }

  const onError = (event: Event) => {
    const { error, message, filename, lineno, colno } = event as Event & {
      error?: unknown
      message?: string
      filename?: string
      lineno?: number
      colno?: number
    }
    logCrash('window.onerror', error ?? message, { filename, lineno, colno })
  }

  target.addEventListener('unhandledrejection', onUnhandledRejection)
  target.addEventListener('error', onError)

  return () => {
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
    target.removeEventListener('error', onError)
    installed = false
  }
}
