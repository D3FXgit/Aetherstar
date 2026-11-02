import { GlassPanel } from '../design/primitives/GlassPanel'
import { GlassButton } from '../design/primitives/GlassButton'
import { useScoreStore } from '../contracts/mocks/stores'
import { useReportScoreState } from './useReportScoreState'

let mockPlayerCounter = 0

/**
 * Drives the audience window through the real state-sync mesh (useScoreStore ->
 * useReportScoreState -> IPC -> the audience window's broadcast), not a shortcut.
 */
export function LabAudience() {
  // Point the broadcast at the mock store for as long as this route is open.
  useReportScoreState(useScoreStore)

  function addMockPlayer() {
    mockPlayerCounter += 1
    const id = `lab-${mockPlayerCounter}`
    const { players, rank } = useScoreStore.getState()
    useScoreStore.setState({
      players: [...players, { playerId: id, name: `Lab ${mockPlayerCounter}`, score: 0, combo: 0, rank: players.length + 1 }],
      rank: [...rank, id],
    })
  }

  function bumpScore(playerId: string, amount: number) {
    const { players } = useScoreStore.getState()
    useScoreStore.setState({
      players: players.map((p) => (p.playerId === playerId ? { ...p, score: Math.min(10_000, p.score + amount) } : p)),
    })
  }

  const players = useScoreStore((s) => s.players)

  return (
    <GlassPanel className="p-8 m-auto max-w-lg flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink-primary">Audience lab</h1>
      <GlassButton type="button" variant="primary" onClick={addMockPlayer}>
        Add mock player
      </GlassButton>
      <div className="flex flex-col gap-2">
        {players.map((player) => (
          <div key={player.playerId} className="flex items-center gap-3 text-sm text-ink-secondary">
            <span className="flex-1">
              {player.name}: {player.score}
            </span>
            <GlassButton type="button" onClick={() => bumpScore(player.playerId, 100)}>
              +100
            </GlassButton>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}
