// Mock implementation of the Audio Manager contract. Tracks real, assertable
// state -- not bare no-op stubs -- so a test can assert the resulting
// currentTrack/currentVolume/isDucked after driving hover/focus ducking.
//
// It models the same named channels the real engine does, so a
// component tested against the mock is tested against the semantics it will
// actually get. `currentTrack`/`currentVolume`/`isDucked` stay as a flattened
// view of the `music` channel -- the default channel, and the one every
// pre-channel caller meant.
import { create } from 'zustand'
import { DEFAULT_AUDIO_CHANNEL, type AudioChannelName, type AudioManager } from './audioManagerContract'

interface MockChannelState {
  currentTrack: string | null
  currentVolume: number
  isDucked: boolean
}

interface MockAudioManagerState extends AudioManager {
  channels: Record<AudioChannelName, MockChannelState>
  currentTrack: string | null
  currentVolume: number
  isDucked: boolean
}

const IDLE_CHANNEL: MockChannelState = { currentTrack: null, currentVolume: 1, isDucked: false }

function initialChannels(): Record<AudioChannelName, MockChannelState> {
  return { music: { ...IDLE_CHANNEL }, preview: { ...IDLE_CHANNEL }, results: { ...IDLE_CHANNEL } }
}

export const useMockAudioManager = create<MockAudioManagerState>((set, get) => {
  /** Applies `patch` to one channel and re-derives the flattened music view. */
  function update(channel: AudioChannelName, patch: MockChannelState) {
    set((state) => {
      const channels = { ...state.channels, [channel]: patch }
      return { channels, ...channels.music }
    })
  }

  return {
    channels: initialChannels(),
    ...IDLE_CHANNEL,

    play: (track, channel = DEFAULT_AUDIO_CHANNEL) =>
      update(channel, { currentTrack: track, currentVolume: 1, isDucked: false }),
    duckTo: (volume, _ms, channel = DEFAULT_AUDIO_CHANNEL) =>
      set((state) => {
        const channels = {
          ...state.channels,
          [channel]: { ...state.channels[channel], currentVolume: volume, isDucked: true },
        }
        return { channels, ...channels.music }
      }),
    restore: (_ms, channel = DEFAULT_AUDIO_CHANNEL) =>
      set((state) => {
        const channels = {
          ...state.channels,
          [channel]: { ...state.channels[channel], currentVolume: 1, isDucked: false },
        }
        return { channels, ...channels.music }
      }),
    crossfadeTo: (track, _ms, channel = DEFAULT_AUDIO_CHANNEL) =>
      update(channel, { currentTrack: track, currentVolume: 1, isDucked: false }),
    // Silence *and* no track -- the difference from duckTo(0, ms), which keeps
    // the track loaded and resumable.
    stop: (_ms, channel = DEFAULT_AUDIO_CHANNEL) =>
      update(channel, { currentTrack: null, currentVolume: 0, isDucked: false }),
    // The same track, moved: `to` now holds what `from` held, `from` is empty.
    transfer: (from, to, _ms, options) => {
      const moving = get().channels[from]
      const track = moving.currentTrack
      if (from === to || track === null) return null
      if (options?.track !== undefined && options.track !== track) return null
      update(to, { ...moving })
      update(from, { currentTrack: null, currentVolume: 0, isDucked: false })
      return { track, durationSec: Number.NaN, positionSec: 0 }
    },
  }
})
