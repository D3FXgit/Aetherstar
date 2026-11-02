import { describe, expect, it, beforeEach } from 'vitest'
import { useStageStore } from '../stageStore'

describe('useStageStore', () => {
  beforeEach(() => {
    useStageStore.getState().reset()
  })

  it('starts idle on line 0 with no active syllable', () => {
    expect(useStageStore.getState()).toMatchObject({ currentLineIndex: 0, activeSyllableIndex: -1, status: 'idle' })
  })

  it('updates the current line index', () => {
    useStageStore.getState().setCurrentLineIndex(3)
    expect(useStageStore.getState().currentLineIndex).toBe(3)
  })

  it('updates the active syllable index', () => {
    useStageStore.getState().setActiveSyllableIndex(2)
    expect(useStageStore.getState().activeSyllableIndex).toBe(2)
  })

  it('updates status', () => {
    useStageStore.getState().setStatus('playing')
    expect(useStageStore.getState().status).toBe('playing')
  })

  it('reset restores the initial values', () => {
    useStageStore.getState().setCurrentLineIndex(5)
    useStageStore.getState().setActiveSyllableIndex(1)
    useStageStore.getState().setStatus('paused')
    useStageStore.getState().reset()
    expect(useStageStore.getState()).toMatchObject({ currentLineIndex: 0, activeSyllableIndex: -1, status: 'idle' })
  })
})
