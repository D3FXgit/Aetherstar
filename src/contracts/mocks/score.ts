import type { ScoreState } from '../types'

function pickRandomPlayerIndex(count: number): number {
  return Math.floor(Math.random() * count)
}

/** Mock score-tick generator — bumps one random player's score/combo, then re-derives rank. */
export function generateScoreTick(prev: ScoreState): ScoreState {
  const players = prev.players.map((player) => ({ ...player }))
  const winnerIndex = pickRandomPlayerIndex(players.length)
  const gain = 50 + Math.floor(Math.random() * 200)

  players[winnerIndex].score += gain
  players[winnerIndex].combo += 1
  for (let i = 0; i < players.length; i++) {
    if (i !== winnerIndex) players[i].combo = Math.random() < 0.3 ? 0 : players[i].combo
  }

  const ranked = [...players].sort((a, b) => b.score - a.score)
  ranked.forEach((player, index) => {
    const original = players.find((p) => p.playerId === player.playerId)
    if (original) original.rank = index + 1
  })

  return {
    players,
    combo: ranked[0].combo,
    rank: ranked.map((player) => player.playerId),
  }
}
