// `leaderboard` phase: the best scores on record, reached from the results screen.
import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useLanguage, useT } from '../i18n'
import { useSessionStore } from './sessionStore'
import { usePlayersStore } from '../players/store'
import { BackButton } from '../scenes/SceneHeader'
import { PlayerBadge } from '../players/PlayerBadge'
import { du, useDesignScale } from '../scenes/designUnits'
import { micRimColor, tokens } from '../design/tokens'
import * as sessionApi from './api'
import { computeRating, rankTitleKey } from './rating'
import { SessionButton } from './SessionButton'
import {
  CARD_STYLE,
  SESSION_BACK_BUTTON_STYLE,
  SESSION_COLORS,
  TEXT,
  displayType,
  sessionScreenStyle,
} from './sessionTheme'
import type { LeaderboardEntry } from './types'

/** Gold, silver and bronze blocks for the podium; everyone else gets a plain number. */
const PODIUM_COLORS = [tokens.accent.gold, 'oklch(0.86 0.02 260)', 'oklch(0.72 0.12 55)'] as const

function playAgain() {
  useSessionStore.getState().playAgain()
}

export function SessionLeaderboard() {
  const t = useT()
  const language = useLanguage()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const players = usePlayersStore((s) => s.players)
  const loadPlayers = usePlayersStore((s) => s.load)
  const reduceMotion = useReducedMotion()
  const scale = useDesignScale()

  useEffect(() => {
    loadPlayers()
    void sessionApi.listLeaderboard().then(setEntries)
  }, [loadPlayers])

  return (
    <div
      className="flex w-full flex-col"
      style={sessionScreenStyle({ minHeight: '100vh', padding: `${du(40)} ${du(64)}`, gap: du(28) })}
      data-testid="session-leaderboard"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between" style={{ gap: du(24) }}>
        <div className="flex items-center" style={{ gap: du(20) }}>
          <BackButton style={SESSION_BACK_BUTTON_STYLE} />
          <div className="flex flex-col" style={{ gap: du(6) }}>
            <h1 style={displayType(48)}>{t('leaderboard.title')}</h1>
            <span style={{ fontSize: `max(0.875rem, ${du(18)})`, fontWeight: 600, color: TEXT.secondary }}>
              {t('leaderboard.subtitle')}
            </span>
          </div>
        </div>
        {entries.length > 0 && (
          <SessionButton tone="primary" type="button" sfx="confirm" onClick={playAgain}>
            {t('leaderboard.singAnother')}
          </SessionButton>
        )}
      </header>

      <div className="w-full flex-1 overflow-y-auto" style={{ maxWidth: du(1320), margin: '0 auto' }}>
        {entries.length === 0 ? (
          <div
            className="m-auto flex flex-col items-center text-center"
            style={{ ...CARD_STYLE, padding: du(56), marginTop: du(40), maxWidth: du(600), gap: du(14) }}
          >
            <h2 style={displayType(32)}>{t('leaderboard.empty.title')}</h2>
            <p style={{ fontSize: `max(1rem, ${du(19)})`, color: TEXT.secondary }}>{t('leaderboard.empty.description')}</p>
            <SessionButton tone="primary" type="button" sfx="confirm" onClick={playAgain} style={{ marginTop: du(12) }}>
              {t('leaderboard.empty.action')}
            </SessionButton>
          </div>
        ) : (
          <ol className="flex flex-col" style={{ gap: du(12) }}>
            {entries.map((entry, index) => {
              const player = players.find((p) => p.id === entry.playerId)
              const playerName = player?.name ?? entry.playerId
              const rating = computeRating(entry.score)
              const podium = PODIUM_COLORS[index]

              return (
                <motion.li
                  key={`${entry.sessionId}-${entry.playerId}-${entry.playedAt}-${index}`}
                  data-testid="leaderboard-row"
                  className="flex items-stretch overflow-hidden"
                  style={{ borderRadius: du(22), background: SESSION_COLORS.surface, minHeight: du(92) }}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { ...tokens.spring.panelEnter, delay: Math.min(index, 10) * 0.04 }}
                >
                  <span
                    className="flex shrink-0 items-center justify-center"
                    style={{
                      ...displayType(36),
                      width: du(84),
                      background: podium ?? SESSION_COLORS.raised,
                      color: podium ? SESSION_COLORS.ink : TEXT.secondary,
                    }}
                  >
                    {index + 1}
                  </span>

                  <div className="flex min-w-0 flex-1 items-center" style={{ gap: du(24), padding: `${du(14)} ${du(28)}` }}>
                    <div className="flex min-w-0 items-center" style={{ gap: du(16), flex: '1 1 0' }}>
                      <PlayerBadge
                        name={playerName}
                        color={player?.color ?? micRimColor(index)}
                        avatarUrl={player?.avatarUrl ?? ''}
                        size={Math.round(52 * scale)}
                      />
                      <div className="flex min-w-0 flex-col" style={{ gap: du(4) }}>
                        <span className="truncate" style={displayType(24, { fontWeight: 800 })}>
                          {playerName}
                        </span>
                        <span style={{ fontSize: `max(0.8125rem, ${du(15)})`, fontWeight: 700, color: TEXT.secondary }}>
                          <span aria-hidden="true" style={{ color: SESSION_COLORS.gold }}>
                            {'★'.repeat(rating.stars)}
                          </span>{' '}
                          {t(rankTitleKey(rating.title))}
                        </span>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col" style={{ gap: du(2), flex: '1 1 0' }}>
                      <span className="truncate" style={{ fontSize: `max(0.9375rem, ${du(19)})`, fontWeight: 700 }}>
                        {entry.songTitle}
                      </span>
                      <span className="truncate" style={{ fontSize: `max(0.8125rem, ${du(16)})`, color: TEXT.secondary }}>
                        {entry.songArtist}
                      </span>
                    </div>

                    <div className="flex shrink-0 flex-col items-end" style={{ gap: du(2) }}>
                      <span style={{ ...displayType(36), fontVariantNumeric: 'tabular-nums', color: podium ?? TEXT.primary }}>
                        {entry.score.toLocaleString(language)}
                      </span>
                      <span style={{ fontSize: `max(0.75rem, ${du(14)})`, fontWeight: 700, color: TEXT.tertiary }}>
                        {t('leaderboard.notes', { epic: entry.epicCount, good: entry.goodCount })}
                      </span>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </ol>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end">
        <span style={{ fontSize: `max(0.875rem, ${du(16)})`, fontWeight: 700, color: TEXT.tertiary }}>
          {t('leaderboard.count', { count: entries.length })}
        </span>
      </footer>
    </div>
  )
}
