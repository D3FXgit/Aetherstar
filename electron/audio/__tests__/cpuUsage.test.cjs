// @vitest-environment node
const { sampleCpuUsage } = require('../cpuUsage.cjs')

describe('sampleCpuUsage', () => {
  it('reports the percentage of one core consumed over the elapsed window', () => {
    // 50ms of user+system CPU time over a 100ms wall-clock window == 50%.
    const prevUsage = { user: 0, system: 0 }
    const nowUsage = () => ({ user: 30_000, system: 20_000 }) // microseconds
    const hrtime = { prev: 0n, now: 100_000_000n } // nanoseconds, 100ms elapsed

    const result = sampleCpuUsage(prevUsage, hrtime.prev, () => nowUsage(), () => hrtime.now)

    expect(result.percent).toBeCloseTo(50, 0)
  })

  it('returns a sample usable as the next call\'s prevUsage', () => {
    const nowUsage = { user: 10_000, system: 5_000 }
    const result = sampleCpuUsage({ user: 0, system: 0 }, 0n, () => nowUsage, () => 50_000_000n)

    expect(result.sample).toEqual(nowUsage)
  })

  it('reports 0% when no CPU time elapsed', () => {
    const usage = { user: 1000, system: 1000 }
    const result = sampleCpuUsage(usage, 0n, () => usage, () => 1_000_000n)
    expect(result.percent).toBe(0)
  })
})
