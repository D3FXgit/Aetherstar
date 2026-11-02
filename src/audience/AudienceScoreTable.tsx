import { memo, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AudienceSurface } from './AudienceSurface'
import { fetchPlayerProfiles, buildProfileMap } from './playerLookup'
import { PlayerBadge } from '../players/PlayerBadge'
import { micRimColor, tokens } from '../design/tokens'
import { useT } from '../i18n'
import type { PlayerProfile, PlayerScore, ScoreState } from '../contracts/types'

/**
 * The bare ranked scoreboard: ranked rows and a leader spotlight.
 *
 * Shown for the audience lab scene, and for any payload that reports scores without
 * saying which screen the host is on.
 */
export const AudienceScoreTable = memo(function AudienceScoreTable({ scoreState }: { scoreState: ScoreState }) {
  const [profiles, setProfiles] = useState<Map<string, PlayerProfile>>(new Map())

  useEffect(() => {
    fetchPlayerProfiles().then((list) => setProfiles(buildProfileMap(list)))
  }, [])

  const rankedIds = scoreState.rank
  const byId = new Map(scoreState.players.map((p) => [p.playerId, p]))
  // There are no mic numbers here, so a player's slot is their place in the
  // players list (join order), which does not move when the ranking does.
  const colorById = new Map(scoreState.players.map((p, index) => [p.playerId, micRimColor(index)]))
  const leaderId = rankedIds[0]
  const leader = leaderId ? byId.get(leaderId) : undefined

  return (
    <AudienceSurface testId="audience-scoreboard">
      <div className="flex h-full gap-10 p-20">
        <div className="flex-1 flex flex-col gap-5">
          <AnimatePresence>
            {rankedIds.map((playerId, index) => {
              const player = byId.get(playerId)
              if (!player) return null
              return (
                <ScoreboardRow
                  key={playerId}
                  player={player}
                  color={colorById.get(playerId) ?? micRimColor(index)}
                  avatarUrl={profiles.get(playerId)?.avatarUrl ?? ''}
                  rank={index + 1}
                  isLeader={playerId === leaderId}
                />
              )
            })}
          </AnimatePresence>
        </div>

        {leader && (
          <LeaderSpotlight
            player={leader}
            color={colorById.get(leader.playerId) ?? micRimColor(0)}
            avatarUrl={profiles.get(leader.playerId)?.avatarUrl ?? ''}
          />
        )}
      </div>
    </AudienceSurface>
  )
})

const ScoreboardRow = memo(function ScoreboardRow({
  player,
  color,
  avatarUrl,
  rank,
  isLeader,
}: {
  player: PlayerScore
  color: string
  avatarUrl: string
  rank: number
  isLeader: boolean
}) {
  return (
    <motion.div
      layoutId={`row-${player.playerId}`}
      data-testid={`player-${player.playerId}`}
      className="flex items-center gap-6 rounded-2xl border border-line bg-surface-panel p-4"
      transition={{ type: 'spring', ...tokens.spring.sceneTransition }}
    >
      <span className="w-10 text-center text-2xl font-bold tabular-nums text-ink-tertiary">{rank}</span>
      <PlayerBadge name={player.name} color={color} avatarUrl={avatarUrl} size={64} />
      {/* The leader marker sits on this inner span so a one-player table still
          answers both `player-<id>` and `leader` test ids. */}
      <span className="flex-1 text-2xl font-bold text-ink-primary" data-testid={isLeader ? 'leader' : undefined}>
        {player.name}
      </span>
      <span className="font-mono text-3xl font-bold tabular-nums text-ink-primary">{player.score}</span>
    </motion.div>
  )
})

function LeaderSpotlight({ player, color, avatarUrl }: { player: PlayerScore; color: string; avatarUrl: string }) {
  const t = useT()

  return (
    <div className="flex w-[420px] flex-col gap-6 rounded-[34px] border border-line bg-surface-panel p-9">
      <span className="text-xl font-semibold text-ink-secondary">{t('audience.scoreboard.leader')}</span>
      <div className="flex items-center gap-6">
        <PlayerBadge name={player.name} color={color} avatarUrl={avatarUrl} size={100} />
        <span className="text-4xl font-bold text-ink-primary">{player.name}</span>
      </div>
      <div className="rounded-2xl border border-line bg-surface-raised p-5">
        <div className="font-mono text-3xl font-bold tabular-nums" style={{ color: tokens.accent.gold }}>
          {player.score}
        </div>
        <div className="mt-1 text-base font-semibold text-ink-tertiary">{t('audience.scoreboard.score')}</div>
      </div>
    </div>
  )
}
