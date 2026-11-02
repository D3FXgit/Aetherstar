import { describe, expect, it, beforeEach } from 'vitest'
import {
  useSongPreviewStore,
  MENU_MUSIC_STOP_MS,
  PREVIEW_BROWSE_FADE_MS,
  PREVIEW_CROSSFADE_MS,
  PREVIEW_HANDOVER_MS,
  PREVIEW_LAUNCH_FADE_MS,
} from '../songPreviewStore'
import { SONG_SELECTED_PEAK_OFFSET_MS } from '../sfxAssets'

describe('songPreviewStore -- the session-scoped owner of the preview channel', () => {
  beforeEach(() => {
    useSongPreviewStore.setState({ track: null })
  })

  it('holds the requested track', () => {
    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/a.mp3')
    expect(useSongPreviewStore.getState().track).toBe('aetherstar-media://roots/a.mp3')
  })

  // The whole reason this store exists rather than a `useState` inside the
  // Song Selector: the screen unmounts on the way to Player Selection, and the
  // preview has to survive that. A re-request of the *same* track must not
  // even notify subscribers, because a notification is what would make the
  // policy site tear the source down and start it again.
  it('re-requesting the same track is a no-op that notifies nobody', () => {
    const track = 'aetherstar-media://roots/a.mp3'
    useSongPreviewStore.getState().requestPreview(track)

    let notifications = 0
    const unsubscribe = useSongPreviewStore.subscribe(() => {
      notifications += 1
    })
    useSongPreviewStore.getState().requestPreview(track)
    useSongPreviewStore.getState().requestPreview(track)
    unsubscribe()

    expect(notifications).toBe(0)
  })

  it('clearing an already-clear store notifies nobody either', () => {
    let notifications = 0
    const unsubscribe = useSongPreviewStore.subscribe(() => {
      notifications += 1
    })
    useSongPreviewStore.getState().clearPreview()
    unsubscribe()

    expect(notifications).toBe(0)
  })

  it('a different track does notify', () => {
    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/a.mp3')

    let notifications = 0
    const unsubscribe = useSongPreviewStore.subscribe(() => {
      notifications += 1
    })
    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/b.mp3')
    unsubscribe()

    expect(notifications).toBe(1)
  })

  // The measured constant this whole handoff is built around: the preview has
  // to be *at* zero before song_selected.wav reaches full level, not merely
  // fading when it does.
  it('the launch fade finishes before song_selected.wav peaks', () => {
    expect(PREVIEW_LAUNCH_FADE_MS).toBeGreaterThan(0)
    expect(PREVIEW_LAUNCH_FADE_MS).toBeLessThan(SONG_SELECTED_PEAK_OFFSET_MS)
  })

  // "Stops immediately" is the requirement; a 0 ms stop is a click, so it is a
  // fade -- but one short enough that nobody hears it as a fade-out, and far
  // shorter than the browse-fade used between two previews.
  it('the menu-music stop is short enough to read as immediate', () => {
    expect(MENU_MUSIC_STOP_MS).toBeGreaterThan(0)
    expect(MENU_MUSIC_STOP_MS).toBeLessThan(PREVIEW_BROWSE_FADE_MS)
  })
  it('carries an optional #PREVIEWSTART with the request, and clears it with the track', () => {
    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/c.mp3', { previewStartSec: 41.2 })
    expect(useSongPreviewStore.getState().previewStartSec).toBe(41.2)

    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/d.mp3')
    expect(useSongPreviewStore.getState().previewStartSec).toBeNull()

    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/d.mp3', { previewStartSec: -5 })
    expect(useSongPreviewStore.getState().previewStartSec).toBeNull()

    useSongPreviewStore.getState().requestPreview('aetherstar-media://roots/d.mp3', { previewStartSec: 12 })
    useSongPreviewStore.getState().clearPreview()
    expect(useSongPreviewStore.getState()).toMatchObject({ track: null, previewStartSec: null })
  })})

describe('songPreviewStore -- playing a preview through and reporting its end', () => {
  const A = 'aetherstar-media://roots/a.mp3'
  const B = 'aetherstar-media://roots/b.mp3'

  beforeEach(() => {
    useSongPreviewStore.setState({ track: null, previewStartSec: null, loop: true, endedTrack: null })
  })

  it('loops unless asked not to', () => {
    useSongPreviewStore.getState().requestPreview(A)
    expect(useSongPreviewStore.getState().loop).toBe(true)

    useSongPreviewStore.getState().requestPreview(B, { loop: false })
    expect(useSongPreviewStore.getState().loop).toBe(false)
  })

  it('marks the requested track as ended, and only that one', () => {
    useSongPreviewStore.getState().requestPreview(A, { loop: false })

    useSongPreviewStore.getState().notifyEnded(B)
    expect(useSongPreviewStore.getState().endedTrack).toBeNull()

    useSongPreviewStore.getState().notifyEnded(A)
    expect(useSongPreviewStore.getState().endedTrack).toBe(A)
  })

  it('a new request clears the mark; re-requesting the ended track keeps it, notifying nobody', () => {
    useSongPreviewStore.getState().requestPreview(A, { loop: false })
    useSongPreviewStore.getState().notifyEnded(A)

    let notifications = 0
    const unsubscribe = useSongPreviewStore.subscribe(() => {
      notifications += 1
    })
    useSongPreviewStore.getState().requestPreview(A, { loop: false })
    useSongPreviewStore.getState().notifyEnded(A)
    unsubscribe()
    expect(notifications).toBe(0)
    expect(useSongPreviewStore.getState().endedTrack).toBe(A)

    useSongPreviewStore.getState().requestPreview(B, { loop: false })
    expect(useSongPreviewStore.getState().endedTrack).toBeNull()
  })

  it('clearing the preview clears the mark and restores the loop default', () => {
    useSongPreviewStore.getState().requestPreview(A, { loop: false })
    useSongPreviewStore.getState().notifyEnded(A)

    useSongPreviewStore.getState().clearPreview()

    expect(useSongPreviewStore.getState()).toMatchObject({ track: null, endedTrack: null, loop: true })
  })

  it('crossfades between songs quickly enough to feel instant (200-250 ms), and glides a handed-over song over 400 ms', () => {
    expect(PREVIEW_CROSSFADE_MS).toBeGreaterThanOrEqual(200)
    expect(PREVIEW_CROSSFADE_MS).toBeLessThanOrEqual(250)
    expect(PREVIEW_HANDOVER_MS).toBe(400)
  })
})
