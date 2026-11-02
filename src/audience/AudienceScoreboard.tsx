import { useMemo } from 'react'
import { useAudienceFeed, useAudienceSlice, useAudienceView } from './useAudienceState'
import { AudienceIdle } from './AudienceIdle'
import { AudienceLineup } from './AudienceLineup'
import { AudienceResultsView } from './AudienceResultsView'
import { AudienceScoreTable } from './AudienceScoreTable'
import { AudienceSingerView } from './AudienceSingerView'
import { installAudienceHostBroadcast } from './audienceBroadcast'

/**
 * The audience display. It mirrors whichever screen the host is on, minus
 * everything interactive:
 *
 *   host idle / home          the main screen, without the buttons
 *   host player selection     the song, cover centred, singers listed as picked
 *   host singing              the singer view: song, lyrics, live scores
 *   host results              the celebration, without the buttons
 *
 * Nothing here is focusable, takes input or makes a sound (the window is
 * created `focusable: false`, see electron/windows/audience-window.cjs). The
 * whole state arrives over one IPC channel, composed by ./audienceBroadcast.ts.
 */

/**
 * Start the host half of the mesh from module scope. App.tsx imports this
 * module statically in both windows, so it runs before any store can change.
 * A no-op in the audience window and wherever there is no preload surface.
 */
if (typeof window !== 'undefined' && window.api?.getWindowRole?.() === 'main') {
  installAudienceHostBroadcast()
}

/**
 * The audience root. It subscribes to the channel once (`useAudienceFeed`) and
 * itself selects nothing but the view name, so a message that only moves the
 * clock anchor re-renders the singer view's own slice -- not this switch, and
 * not whichever screen is not showing. Each view reads exactly the fields it
 * draws (see useAudienceState.ts for the structural sharing that makes the
 * selectors meaningful).
 */
export function AudienceScoreboard() {
  useAudienceFeed()
  const view = useAudienceView()

  switch (view) {
    case 'lineup':
      return <LineupView />
    case 'play':
      return <PlayView />
    case 'results':
      return <ResultsView />
    case 'scoreboard':
      return <ScoreTableView />
    case 'idle':
    default:
      return <AudienceIdle />
  }
}

function LineupView() {
  const { song, singers } = useAudienceSlice('song', 'singers')
  return <AudienceLineup song={song} singers={singers} />
}

function PlayView() {
  const state = useAudienceSlice(
    'song',
    'mode',
    'singers',
    'players',
    'lyrics',
    'playback',
    'clears',
    'pitches',
    'micRigConfigured',
  )
  return (
    <AudienceSingerView
      song={state.song}
      mode={state.mode}
      singers={state.singers}
      players={state.players}
      lyrics={state.lyrics}
      playback={state.playback}
      clears={state.clears}
      pitches={state.pitches}
      micRigConfigured={state.micRigConfigured}
    />
  )
}

function ResultsView() {
  const { song, results } = useAudienceSlice('song', 'results')
  return <AudienceResultsView song={song} results={results} />
}

function ScoreTableView() {
  const { players, combo, rank } = useAudienceSlice('players', 'combo', 'rank')
  // Stable while the three fields are, so the memo'd table can skip renders.
  const scoreState = useMemo(() => ({ players, combo, rank }), [players, combo, rank])
  return <AudienceScoreTable scoreState={scoreState} />
}
