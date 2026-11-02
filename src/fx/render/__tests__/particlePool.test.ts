import { describe, expect, it } from 'vitest'
import { acquire, createPool, release } from '../particlePool'

describe('particlePool', () => {
  it('creates a pool of inactive entries', () => {
    const pool = createPool(3, () => ({}))
    expect(pool).toHaveLength(3)
    expect(pool.every((p) => p.active === false)).toBe(true)
  })

  it('acquire marks an entry active and returns it', () => {
    const pool = createPool(2, () => ({}))
    const acquired = acquire(pool)
    expect(acquired).not.toBeNull()
    expect(acquired!.active).toBe(true)
  })

  it('returns null when the pool is exhausted, never allocating a new entry', () => {
    const pool = createPool(1, () => ({}))
    acquire(pool)
    expect(acquire(pool)).toBeNull()
    expect(pool).toHaveLength(1)
  })

  it('release makes an entry acquirable again', () => {
    const pool = createPool(1, () => ({}))
    const acquired = acquire(pool)!
    release(acquired)
    expect(acquired.active).toBe(false)
    expect(acquire(pool)).not.toBeNull()
  })
})
