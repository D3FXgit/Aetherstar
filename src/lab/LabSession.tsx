// /lab/session: drives the party state machine with mock songs, players and
// scores. Sets useSessionStore's state directly (not its navigating actions),
// so clicking through never leaves this scene.
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { useSceneStore } from '../scenes/sceneStore'
import { useSessionStore } from '../session/sessionStore'
import type { LibrarySong } from '../library/types'

const MOCK_SONG: LibrarySong = {
  path: '/lab/mock-song',
  artist: 'Lab Artist',
  title: 'Lab Song',
  durationMs: 120000,
  thumbnailPath: null,
  mp3Path: null,
  videoPath: null,
  bpm: 120,
  gap: 0,
  hasVideo: false,
  hasCover: false,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}
const MOCK_PLAYER_ID = 'lab-mock-player'
const MOCK_RESULT = [
  {
    playerId: MOCK_PLAYER_ID,
    score: 4200,
    epicCount: 5,
    goodCount: 2,
    awfulCount: 1,
    bestLine: 'Mock best line',
  },
]

export function LabSession() {
  const phase = useSessionStore((state) => state.phase)
  const sessionId = useSessionStore((state) => state.sessionId)
  const selectedSong = useSessionStore((state) => state.selectedSong)
  const lastResult = useSessionStore((state) => state.lastResult)

  return (
    <GlassPanel className="p-8 m-auto max-w-lg flex flex-col gap-3" data-testid="lab-session">
      <button
        type="button"
        className="text-sm text-ink-secondary self-start"
        onClick={() => useSceneStore.getState().navigate('lab')}
      >
        ← Back to Dev Lab
      </button>
      <h1 className="text-2xl font-semibold text-ink-primary">Session lab</h1>
      <p data-testid="lab-session-phase" className="text-ink-secondary text-sm">
        Phase: {phase}
      </p>
      {selectedSong && <p className="text-ink-secondary text-sm">Song: {selectedSong.title}</p>}
      {lastResult && lastResult.length > 0 && (
        <p data-testid="lab-session-result" className="text-ink-secondary text-sm">
          Score: {lastResult[0].score}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <GlassButton
          type="button"
          onClick={() => useSessionStore.setState({ phase: 'select', sessionId: sessionId ?? 'lab-session-id' })}
        >
          Mock: enter select
        </GlassButton>
        <GlassButton type="button" onClick={() => useSessionStore.setState({ selectedSong: MOCK_SONG, phase: 'assign' })}>
          Mock: pick song → assign
        </GlassButton>
        <GlassButton
          type="button"
          onClick={() => useSessionStore.setState({ assignedPlayerIds: [MOCK_PLAYER_ID], phase: 'play' })}
        >
          Mock: assign player → play
        </GlassButton>
        <GlassButton type="button" onClick={() => useSessionStore.setState({ lastResult: MOCK_RESULT, phase: 'results' })}>
          Mock: finish song → results
        </GlassButton>
        <GlassButton type="button" onClick={() => useSessionStore.setState({ phase: 'leaderboard' })}>
          Mock: view leaderboard
        </GlassButton>
      </div>
    </GlassPanel>
  )
}
