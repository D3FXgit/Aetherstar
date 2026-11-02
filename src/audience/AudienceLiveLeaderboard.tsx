import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PlayerBadge } from '../players/PlayerBadge'
import { MicChip } from './AudienceSurface'
import { micColor, textColor, tokens, withAlpha } from '../design/tokens'
import { useT } from '../i18n'
import type { PlayerScore } from '../contracts/types'
import type { AudienceSinger } from './types'

interface AudienceLiveLeaderboardProps {
  singers: AudienceSinger[]
  players: PlayerScore[]
}

interface RankedSinger extends AudienceSinger {
  scoreValue: number
  rank: number
  diffFromLeader: number
}

/** How long the "new leader" banner stays up after an overtake. */
export const OVERTAKE_BANNER_MS = 3000

/** Flat podium fills for the place chip: gold, silver, bronze. */
const PODIUM_FILL: Record<number, string> = {
  1: tokens.accent.gold,
  2: 'oklch(0.80 0.02 250)',
  3: 'oklch(0.68 0.12 60)',
}

/** Language-file keys for the podium places; everyone else gets `other`. */
const PLACE_KEY: Record<number, string> = {
  1: 'audience.live.place.first',
  2: 'audience.live.place.second',
  3: 'audience.live.place.third',
}

function rankSingers(singers: AudienceSinger[], players: PlayerScore[]): RankedSinger[] {
  const scoreByPlayerId = new Map(players.map((p) => [p.playerId, p]))
  return [...singers]
    .map((singer) => {
      const score = singer.playerId ? scoreByPlayerId.get(singer.playerId) : undefined
      return { ...singer, scoreValue: score?.score ?? 0, rank: 1, diffFromLeader: 0 }
    })
    .sort((a, b) => {
      if (b.scoreValue !== a.scoreValue) return b.scoreValue - a.scoreValue
      return a.micNumber - b.micNumber
    })
    .map((item, index, arr) => {
      const leaderScore = arr[0]?.scoreValue ?? 0
      return {
        ...item,
        rank: index + 1,
        diffFromLeader: leaderScore > 0 ? leaderScore - item.scoreValue : 0,
      }
    })
}

/**
 * The live score cards under the singer view, over the song's video.
 *
 * Translucent dark fills rather than a backdrop blur, which would re-sample the
 * video behind every card on every frame. Memoised because most of the ~30
 * payloads a second change nothing drawn here.
 */
export const AudienceLiveLeaderboard = memo(function AudienceLiveLeaderboard({
  singers,
  players,
}: AudienceLiveLeaderboardProps) {
  const t = useT()
  const rankedSingers = useMemo(() => rankSingers(singers, players), [singers, players])

  const currentLeader = rankedSingers[0]
  // Primitives, not the leader object: `rankSingers` builds new objects on
  // every score tick, and an effect keyed on one would cancel its own timer.
  const leaderId =
    currentLeader && currentLeader.scoreValue > 0 ? (currentLeader.playerId ?? `mic-${currentLeader.micNumber}`) : null
  const leaderName = currentLeader?.name ?? ''
  const leaderMic = currentLeader?.micNumber ?? 0

  const [overtakeBanner, setOvertakeBanner] = useState<{ leaderName: string; micNumber: number } | null>(null)
  const lastLeaderIdRef = useRef<string | null>(null)
  // The dismiss timer lives in a ref, not in the effect's cleanup: the banner
  // must come down three seconds after the overtake whatever re-renders in
  // between, and only an unmount (below) may cancel it early.
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (leaderId === null) return
    const previous = lastLeaderIdRef.current
    lastLeaderIdRef.current = leaderId
    if (previous === null || previous === leaderId) return

    setOvertakeBanner({ leaderName, micNumber: leaderMic })
    if (bannerTimerRef.current !== null) clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = setTimeout(() => {
      bannerTimerRef.current = null
      setOvertakeBanner(null)
    }, OVERTAKE_BANNER_MS)
  }, [leaderId, leaderName, leaderMic])

  useEffect(
    () => () => {
      if (bannerTimerRef.current !== null) clearTimeout(bannerTimerRef.current)
    },
    [],
  )

  // Framer's `layout` measures the DOM on every render by default. Scores
  // change many times a second; the *order* (the only thing the layout
  // animation exists to show) changes rarely. Measure only when it does.
  const orderKey = rankedSingers.map((singer) => singer.micNumber).join(',')

  if (singers.length === 0) return null

  const leaderScore = currentLeader?.scoreValue ?? 1

  return (
    <div className="relative flex flex-col items-center gap-3 shrink-0">
      <AnimatePresence>
        {overtakeBanner && (
          <motion.div
            key="overtake-banner"
            data-testid="audience-overtake-banner"
            initial={{ scale: 0.8, y: 15, opacity: 0 }}
            animate={{ scale: [1, 1.08, 1], y: 0, opacity: 1 }}
            exit={{ scale: 0.85, y: -10, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="absolute -top-14 z-30 flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-5 text-[clamp(0.95rem,1.2vw,1.35rem)] font-bold text-black"
            style={{ background: tokens.accent.gold, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}
          >
            <MicChip micNumber={overtakeBanner.micNumber} size={28} />
            <span>{t('audience.live.newLeader', { name: overtakeBanner.leaderName })}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <ul
        data-testid="audience-live-scores"
        className="flex shrink-0 items-stretch justify-center gap-[1.8vw] max-w-full flex-wrap"
      >
        <AnimatePresence initial={false}>
          {rankedSingers.map((singer) => {
            const rim = micColor(singer.micNumber)
            const isLeader = singer.rank === 1 && singer.scoreValue > 0
            const podiumFill = singer.scoreValue > 0 ? PODIUM_FILL[singer.rank] : undefined
            const placeKey = singer.scoreValue > 0 ? PLACE_KEY[singer.rank] : undefined

            // The bar shows each singer's score against the leader's.
            const scorePct = leaderScore > 0 ? Math.min(100, Math.max(8, (singer.scoreValue / leaderScore) * 100)) : 100

            return (
              <motion.li
                key={`${singer.micNumber}-${singer.name}`}
                layout
                layoutDependency={orderKey}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                data-testid="audience-live-score"
                data-mic-number={singer.micNumber}
                // No `transition-all`: a CSS transition on every property
                // fights framer's own layout transform.
                className="relative flex min-w-[210px] flex-col justify-between overflow-hidden rounded-3xl bg-black/65 p-3.5"
                style={{
                  border: isLeader ? `2px solid ${tokens.accent.gold}` : `1px solid ${withAlpha(rim, 0.5)}`,
                }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span
                    className="flex items-center justify-center rounded-lg px-2 py-0.5 text-[13px] font-extrabold tabular-nums"
                    style={{
                      background: podiumFill ?? 'rgba(255,255,255,0.12)',
                      color: podiumFill ? '#0f0d14' : textColor('secondary'),
                    }}
                  >
                    {placeKey ? t(placeKey) : t('audience.live.place.other', { rank: singer.rank })}
                  </span>
                  <MicChip micNumber={singer.micNumber} size={22} />
                </div>

                <div className="flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    <PlayerBadge name={singer.name} color={rim} avatarUrl={singer.avatarUrl} size={46} />
                    {isLeader && (
                      <span aria-hidden className="absolute -top-2 -right-1 text-sm">
                        👑
                      </span>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="truncate text-[clamp(0.85rem,1.1vw,1.15rem)] font-bold text-ink-primary">
                        {singer.name}
                      </span>
                      {singer.diffFromLeader > 0 && (
                        <span className="shrink-0 text-xs font-medium tabular-nums text-ink-tertiary">
                          -{singer.diffFromLeader.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <span
                      className="font-mono text-[clamp(1.15rem,1.8vw,2rem)] font-extrabold tracking-tight tabular-nums"
                      style={{ color: isLeader ? tokens.accent.gold : textColor('primary') }}
                    >
                      {singer.scoreValue.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  {/* scaleX, not width: a transform animates on the
                      compositor, where a width animation re-lays-out the
                      card on every spring frame. */}
                  <motion.div
                    data-testid="audience-live-score-bar"
                    className="h-full w-full rounded-full"
                    style={{
                      background: isLeader ? tokens.accent.gold : rim,
                      transformOrigin: 'left center',
                    }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: scorePct / 100 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                  />
                </div>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
})
