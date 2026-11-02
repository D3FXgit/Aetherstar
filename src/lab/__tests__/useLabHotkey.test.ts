import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLabHotkey } from '../useLabHotkey'
import { useSceneStore } from '../../scenes/sceneStore'

function pressHotkey({ meta = false, ctrl = false }: { meta?: boolean; ctrl?: boolean }) {
  const event = new KeyboardEvent('keydown', {
    key: 'D',
    shiftKey: true,
    metaKey: meta,
    ctrlKey: ctrl,
    bubbles: true,
  })
  document.dispatchEvent(event)
}

describe('useLabHotkey', () => {
  beforeEach(() => {
    useSceneStore.setState({ current: 'home' })
  })

  it('navigates to the lab scene on Cmd+Shift+D', () => {
    const { unmount } = renderHook(() => useLabHotkey())

    pressHotkey({ meta: true })

    expect(useSceneStore.getState().current).toBe('lab')
    unmount()
  })

  it('navigates to the lab scene on Ctrl+Shift+D', () => {
    const { unmount } = renderHook(() => useLabHotkey())

    pressHotkey({ ctrl: true })

    expect(useSceneStore.getState().current).toBe('lab')
    unmount()
  })

  afterEach(() => {
    useSceneStore.setState({ current: 'home' })
  })
})
