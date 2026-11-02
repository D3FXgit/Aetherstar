// `results` phase: every singer's score, rank and stars, with the winner
// celebrated in six beats (resultsChoreography.ts). The write-backs fire once on
// mount, independent of the beats; the sequence is skippable, and under reduced
// motion the finished state is the first frame.
import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useT } from '../i18n'
import { useSfx } from '../audio/useSfx'
import { usePlayersStore } from '../players/store'
import { du, useDesignScale } from '../scenes/designUnits'
import { easing, springTransition } from '../design/tokens'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { useSessionStore } from './sessionStore'
import { ResultsConfetti } from './ResultsConfetti'
import { BEAT_DURATIONS, isAtLeast } from './resultsChoreography'
import {
  BUTTON_HOVER_CLASS,
  SESSION_COLORS,
  TEXT,
  displayType,
  primaryButtonStyle,
  secondaryButtonStyle,
} from './sessionTheme'
import { ResultsSurface } from './results/ResultsSurface'
import { RosterRow } from './results/RosterRow'
import { VersusBanner } from './results/VersusBanner'
import { WinnerCard } from './results/WinnerCard'
import { rankSingers } from './results/singers'
import { resultsAnnouncement } from './results/resultsAnnouncement'
import { useResultsChoreography } from './results/useResultsChoreography'
import { useResultsWriteBack } from './results/useResultsWriteBack'

const ROSTER_COLUMN_UNITS = 680
const COLUMN_GAP_UNITS = 48

export function SessionResults() {
  const t = useT()
  const lastResult = useSessionStore((state) => state.lastResult)
  const sessionMode = useSessionStore((state) => state.mode)
  const assignPlayers = useSessionStore((state) => state.assignPlayers)
  const selectedSong = useSessionStore((state) => state.selectedSong)
  const sessionId = useSessionStore((state) => state.sessionId)
  const assignedPlayerIds = useSessionStore((state) => state.assignedPlayerIds)
  const playAgain = useSessionStore((state) => state.playAgain)
  const endSession = useSessionStore((state) => state.endSession)
  const viewLeaderboard = useSessionStore((state) => state.viewLeaderboard)
  const players = usePlayersStore((state) => state.players)
  const playSfx = useSfx((state) => state.play)
  const reduceMotion = useReducedMotion() ?? false
  // One design unit in px, for sizes that must be numbers (PlayerBadge, confetti travel).
  const scale = useDesignScale()

  const { chart } = useChartLoader(selectedSong?.path ?? null)
  const newHighscores = useResultsWriteBack(lastResult, selectedSong, sessionId)

  const singers = useMemo(
    () => rankSingers({ results: lastResult ?? [], assignedPlayerIds, players, chart, newHighscores }),
    [lastResult, assignedPlayerIds, players, chart, newHighscores],
  )
  const winner = singers[0] ?? null
  const others = singers.slice(1)
  const hasResult = winner !== null

  const { beat, settled, skipped, canSkip, skip, skipRef, primaryRef } = useResultsChoreography({
    hasResult,
    score: winner?.result.score ?? 0,
    reduceMotion,
    playSfx,
  })

  // Filled in on the first commit after mount: many screen readers only
  // announce a live region when its contents change.
  const [announced, setAnnounced] = useState(false)
  useEffect(() => {
    if (hasResult) setAnnounced(true)
  }, [hasResult])

  const song = selectedSong ? { title: selectedSong.title, artist: selectedSong.artist } : null

  if (!winner) {
    return (
      <ResultsSurface song={song}>
        <div className="relative flex flex-1 items-center justify-center">
          <p style={{ fontSize: `max(1rem, ${du(24)})`, color: TEXT.secondary }}>{t('results.empty')}</p>
        </div>
      </ResultsSurface>
    )
  }

  const hasOthers = others.length > 0
  const isVersus = sessionMode === 'battle' && hasOthers
  const showCrown = isAtLeast(beat, 'crown')
  // A lone singer stays centred: sliding aside to reveal an empty column is motion for its own sake.
  const slid = hasOthers && isAtLeast(beat, 'slide')
  const showRoster = hasOthers && isAtLeast(beat, 'roster')
  const showCount = isAtLeast(beat, 'count')
  const showActions = isAtLeast(beat, 'actions')
  const actionsReveal = {
    initial: reduceMotion ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduceMotion ? 0 : BEAT_DURATIONS.actionsFadeMs / 1000, ease: easing.standard },
  } as const
  const rowTransition = (index: number) =>
    reduceMotion
      ? { duration: 0 }
      : {
          duration: BEAT_DURATIONS.rosterFadeMs / 1000,
          ease: easing.standard,
          delay: (index * BEAT_DURATIONS.rosterStaggerMs) / 1000,
        }

  const tie = isVersus && winner.result.score === others[0].result.score
  const winnerLabel = isVersus ? t(tie ? 'results.versus.tieLabel' : 'results.versus.winner') : t('results.winner')

  const actions = showActions && (
    <>
      {sessionMode === 'battle' && selectedSong && assignedPlayerIds.length > 0 && (
        <motion.button
          type="button"
          data-testid="results-rematch"
          className={`flex-1 ${BUTTON_HOVER_CLASS}`}
          {...actionsReveal}
          onClick={() => {
            playSfx('confirm')
            assignPlayers(assignedPlayerIds)
          }}
          style={primaryButtonStyle('rgba(18, 17, 24, 0.16)')}
        >
          {t('results.actions.rematch')}
        </motion.button>
      )}
      <motion.button
        ref={primaryRef}
        type="button"
        className={`flex-1 ${BUTTON_HOVER_CLASS}`}
        {...actionsReveal}
        onClick={() => {
          playSfx('confirm')
          playAgain()
        }}
        style={primaryButtonStyle(SESSION_COLORS.ink, { color: TEXT.primary })}
      >
        {t('results.actions.newSong')}
      </motion.button>
    </>
  )

  return (
    <ResultsSurface
      beat={beat}
      song={song}
      trailing={
        canSkip && (
          <button
            ref={skipRef}
            type="button"
            data-testid="results-skip"
            className={BUTTON_HOVER_CLASS}
            style={secondaryButtonStyle()}
            onClick={skip}
          >
            {t('results.skip')} <span aria-hidden="true">&rsaquo;&rsaquo;</span>
          </button>
        )
      }
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="results-announcer">
        {announced ? resultsAnnouncement(t, winner, others) : ''}
      </div>

      {/* `relative` because the confetti anchors here; nothing clips, the pieces are meant to leave. */}
      <motion.div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ gap: du(24) }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={springTransition('panelEnter', reduceMotion)}
      >
        <ResultsConfetti active={showCrown && !skipped} scale={scale} />

        {isVersus && <VersusBanner winner={winner} runnerUp={others[0]} reduceMotion={reduceMotion} />}

        {/* The pair shares a top edge while being centred together. */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex max-h-full items-start justify-center" style={{ gap: du(COLUMN_GAP_UNITS) }}>
            <WinnerCard
              winner={winner}
              label={winnerLabel}
              slid={slid}
              showCrown={showCrown}
              showCount={showCount}
              settled={settled}
              reduceMotion={reduceMotion}
              onTick={() => playSfx('scoreTick')}
              scale={scale}
              actions={actions}
            />

            {/* Mounted (and reserving its width) at the slide, so the winner has somewhere to go;
                rows fade in a beat later. Scrolls so a party of eight always fits. */}
            {slid && (
              <div
                className="flex min-h-0 shrink-0 flex-col"
                style={{ width: du(ROSTER_COLUMN_UNITS), maxHeight: '100%', gap: du(14) }}
              >
                <span style={displayType(24, { fontWeight: 800, color: TEXT.secondary })}>
                  {t('results.alsoSinging')}
                </span>
                <div
                  className="flex min-h-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{ gap: du(12) }}
                  data-testid="results-ranked-column"
                >
                  {showRoster &&
                    others.map((singer, index) => (
                      <RosterRow
                        key={singer.result.playerId}
                        singer={singer}
                        place={index + 2}
                        showCount={showCount}
                        settled={settled}
                        reduceMotion={reduceMotion}
                        scale={scale}
                        transition={rowTransition(index)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* The two quieter ways off this screen. The bar is there from the first
          frame so nothing above it moves when the buttons land. */}
      <footer
        className="relative flex shrink-0 items-center"
        style={{ gap: du(12), minHeight: `max(2.75rem, ${du(56)})` }}
      >
        {showActions && (
          <motion.div className="flex flex-1 flex-wrap items-center" style={{ gap: du(12) }} {...actionsReveal}>
            <button
              type="button"
              className={BUTTON_HOVER_CLASS}
              style={secondaryButtonStyle()}
              onClick={() => {
                playSfx('back')
                endSession()
              }}
            >
              {t('results.actions.leave')}
            </button>
            {/* The leaderboard's only way in. */}
            <button
              type="button"
              className={BUTTON_HOVER_CLASS}
              style={secondaryButtonStyle()}
              onClick={() => {
                playSfx('click')
                viewLeaderboard()
              }}
            >
              {t('results.actions.leaderboard')}
            </button>
          </motion.div>
        )}
        <span className="ml-auto" style={{ fontWeight: 700, fontSize: `max(0.875rem, ${du(18)})`, color: TEXT.tertiary }}>
          {t('results.singers', { count: singers.length })}
        </span>
      </footer>
    </ResultsSurface>
  )
}

