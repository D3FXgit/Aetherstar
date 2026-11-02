import { useEffect } from 'react'
import { useSceneStore } from '../scenes/sceneStore'

/**
 * Cmd/Ctrl+Shift+D opens the Dev Lab from anywhere in the app -- in
 * development builds only. The lab routes are never registered in production
 * (see registerDevLabs.ts), so the shortcut must not exist there either.
 */
export function useLabHotkey() {
  useEffect(() => {
    if (!import.meta.env.DEV) return

    function handleKeydown(event: KeyboardEvent) {
      const isModifierDown = event.metaKey || event.ctrlKey
      if (isModifierDown && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        useSceneStore.getState().navigate('lab')
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [])
}
