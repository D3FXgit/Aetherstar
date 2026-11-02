import { describe, expect, it } from 'vitest'
import { planStemPlayback } from '../stemPlan'

const MIX = 'app-media://media/song/mix.mp3'
const VOC = 'app-media://media/song/voc.mp3'
const INST = 'app-media://media/song/inst.mp3'

describe('planStemPlayback', () => {
  it('leaves a stemless song exactly as it was: one element, the full mix', () => {
    expect(planStemPlayback({ mixUrl: MIX, vocalsUrl: null, instrumentalUrl: null })).toEqual({
      clockUrl: MIX,
      vocalStemUrl: null,
      usingStems: false,
    })
  })

  it('makes the instrumental the clock and the vocals the follower when both stems exist', () => {
    // The instrumental is never ducked, never nudged and never re-seeked, so
    // it is the stabler of the two to hang the beat clock on.
    expect(planStemPlayback({ mixUrl: MIX, vocalsUrl: VOC, instrumentalUrl: INST })).toEqual({
      clockUrl: INST,
      vocalStemUrl: VOC,
      usingStems: true,
    })
  })

  it('plays a stems-only chart (no full mix at all) off the instrumental', () => {
    expect(planStemPlayback({ mixUrl: null, vocalsUrl: VOC, instrumentalUrl: INST })).toEqual({
      clockUrl: INST,
      vocalStemUrl: VOC,
      usingStems: true,
    })
  })

  it('treats a lone stem as an ordinary single track rather than half a stem pair', () => {
    expect(planStemPlayback({ mixUrl: null, vocalsUrl: null, instrumentalUrl: INST })).toEqual({
      clockUrl: INST,
      vocalStemUrl: null,
      usingStems: false,
    })
    expect(planStemPlayback({ mixUrl: MIX, vocalsUrl: VOC, instrumentalUrl: null })).toEqual({
      clockUrl: MIX,
      vocalStemUrl: null,
      usingStems: false,
    })
  })

  it('falls back to the full mix when the vocal stem fails before playback has started', () => {
    expect(
      planStemPlayback({ mixUrl: MIX, vocalsUrl: VOC, instrumentalUrl: INST, vocalStemFailed: true }),
    ).toEqual({ clockUrl: MIX, vocalStemUrl: null, usingStems: false })
  })

  it('does NOT swap a already-running clock when the vocal stem fails mid-song', () => {
    // The instrumental is the clock and is audible; replacing it now would
    // reload a fresh element at position 0 and break the song outright.
    expect(
      planStemPlayback({
        mixUrl: MIX,
        vocalsUrl: VOC,
        instrumentalUrl: INST,
        vocalStemFailed: true,
        playbackStarted: true,
      }),
    ).toEqual({ clockUrl: INST, vocalStemUrl: null, usingStems: false })
  })

  it('keeps playing the instrumental alone when the vocal stem fails and there is no mix', () => {
    expect(planStemPlayback({ mixUrl: null, vocalsUrl: VOC, instrumentalUrl: INST, vocalStemFailed: true })).toEqual({
      clockUrl: INST,
      vocalStemUrl: null,
      usingStems: false,
    })
  })

  it('replaces a clock that has itself failed — there is no gameplay without one', () => {
    expect(
      planStemPlayback({ mixUrl: MIX, vocalsUrl: VOC, instrumentalUrl: INST, clockFailed: true }),
    ).toEqual({ clockUrl: MIX, vocalStemUrl: null, usingStems: false })
  })

  it('never offers a clock URL that has already failed, so repeated failures reach the error screen instead of alternating', () => {
    const afterFirst = planStemPlayback({
      mixUrl: MIX,
      vocalsUrl: VOC,
      instrumentalUrl: INST,
      failedClockUrls: new Set([INST]),
    })
    expect(afterFirst.clockUrl).toBe(MIX)

    const afterSecond = planStemPlayback({
      mixUrl: MIX,
      vocalsUrl: VOC,
      instrumentalUrl: INST,
      failedClockUrls: new Set([INST, MIX]),
    })
    expect(afterSecond.clockUrl).toBe(VOC)

    expect(
      planStemPlayback({ mixUrl: MIX, vocalsUrl: VOC, instrumentalUrl: INST, failedClockUrls: new Set([INST, MIX, VOC]) })
        .clockUrl,
    ).toBeNull()
  })

  it('reports no clock at all when every candidate has been exhausted', () => {
    expect(planStemPlayback({ mixUrl: MIX, vocalsUrl: null, instrumentalUrl: null, clockFailed: true })).toEqual({
      clockUrl: null,
      vocalStemUrl: null,
      usingStems: false,
    })
    expect(planStemPlayback({ mixUrl: null, vocalsUrl: null, instrumentalUrl: null })).toEqual({
      clockUrl: null,
      vocalStemUrl: null,
      usingStems: false,
    })
  })
})
