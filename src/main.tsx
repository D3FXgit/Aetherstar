import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installGlobalErrorHandlers } from './diagnostics/installGlobalErrorHandlers'
import { initI18n } from './i18n'
import './index.css'

// Installed before the first render so even a failure during mount is recorded.
installGlobalErrorHandlers()

/**
 * The Dev Lab, in development builds only (`import.meta.env.DEV` drops this
 * branch and its chunk from production). Awaited so lab routes exist before
 * the first render; the audience window never needs them.
 */
async function registerDevTools(): Promise<void> {
  if (!import.meta.env.DEV) return
  if (window.api?.getWindowRole() === 'audience') return
  try {
    await import('./lab/registerDevLabs')
  } catch (error) {
    console.error('[dev] failed to register the Dev Lab scenes', error)
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('#root element not found')

/**
 * Language files from disk. The bundled languages already paint the first
 * frame, so this waits only briefly for a user-added language.
 */
function loadLanguages(): Promise<void> {
  return Promise.race([
    initI18n().catch((error) => console.error('[i18n] failed to load language files', error)),
    new Promise<void>((resolve) => setTimeout(resolve, 400)),
  ])
}

void Promise.all([registerDevTools(), loadLanguages()]).then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
