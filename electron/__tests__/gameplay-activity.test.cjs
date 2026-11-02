// @vitest-environment node
const { createGameplayActivity } = require('../gameplay-activity.cjs')

describe('createGameplayActivity', () => {
  it('notifies listeners only on real changes', () => {
    const activity = createGameplayActivity()
    const changes = []
    activity.onChange((active) => changes.push(active))

    expect(activity.set(true)).toBe(true)
    expect(activity.set(true)).toBe(false)
    expect(activity.set(false)).toBe(true)
    expect(changes).toEqual([true, false])
  })

  it('treats anything but true as inactive', () => {
    const activity = createGameplayActivity()
    activity.set('yes')
    expect(activity.isActive()).toBe(false)
  })

  it('whenIdle resolves at once when idle, and when gameplay ends otherwise', async () => {
    const activity = createGameplayActivity()
    await activity.whenIdle()

    activity.set(true)
    let idle = false
    const waiting = activity.whenIdle().then(() => {
      idle = true
    })
    await Promise.resolve()
    expect(idle).toBe(false)

    activity.set(false)
    await waiting
    expect(idle).toBe(true)
  })

  it('keeps notifying the others when one listener throws', () => {
    const activity = createGameplayActivity()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = []
    activity.onChange(() => {
      throw new Error('bad listener')
    })
    activity.onChange((active) => seen.push(active))
    activity.set(true)
    expect(seen).toEqual([true])
    spy.mockRestore()
  })
})
