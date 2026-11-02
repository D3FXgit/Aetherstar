import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWindowRole } from '../useWindowRole'

afterEach(() => {
  delete window.api
})

describe('useWindowRole', () => {
  it('returns "audience" when window.api.getWindowRole() reports it', () => {
    // @ts-expect-error -- only getWindowRole matters for this test
    window.api = { getWindowRole: vi.fn().mockReturnValue('audience') } as Window['api']
    const { result } = renderHook(() => useWindowRole())
    expect(result.current).toBe('audience')
  })

  it('returns "main" when window.api.getWindowRole() reports it', () => {
    // @ts-expect-error -- only getWindowRole matters for this test
    window.api = { getWindowRole: vi.fn().mockReturnValue('main') } as Window['api']
    const { result } = renderHook(() => useWindowRole())
    expect(result.current).toBe('main')
  })

  it('defaults to "main" when window.api is absent (browser preview)', () => {
    const { result } = renderHook(() => useWindowRole())
    expect(result.current).toBe('main')
  })
})
