import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDuelLeadTracker } from './useDuelLeadTracker'
import { usePlayersStore } from '../../players/store'
import { useScoreStore } from '../../game/state/useScoreStore'
import { micRimColor } from '../../design/tokens'
import type { PlayerScore } from '../../contracts/types'
import { useLanguage, useT } from '../../i18n'

interface TugOfWarBarProps {
  player1Id: string
  player2Id: string
  player1Color?: string
  player2Color?: string
  className?: string
  overrideScores?: PlayerScore[]
  silent?: boolean
}

export function TugOfWarBar({
  player1Id,
  player2Id,
  player1Color = micRimColor(0),
  player2Color = micRimColor(1),
  className = '',
  overrideScores,
  silent = false,
}: TugOfWarBarProps) {
  const t = useT()
  const language = useLanguage()
  const metrics = useDuelLeadTracker(player1Id, player2Id, overrideScores, silent)
  const players = usePlayersStore((s) => s.players)
  const storeScores = useScoreStore((s) => s.players)
  const scores = overrideScores ?? storeScores

  const p1Profile = players.find((p) => p.id === player1Id)
  const p2Profile = players.find((p) => p.id === player2Id)
  const p1Name = p1Profile?.name ?? t('duel.player', { number: 1 })
  const p2Name = p2Profile?.name ?? t('duel.player', { number: 2 })

  const s1 = scores.find((p) => p.playerId === player1Id)?.score ?? 0
  const s2 = scores.find((p) => p.playerId === player2Id)?.score ?? 0

  const [showLeadChange, setShowLeadChange] = useState(false)

  useEffect(() => {
    if (metrics.leadSwapCount > 0) {
      setShowLeadChange(true)
      const timer = setTimeout(() => setShowLeadChange(false), 2400)
      return () => clearTimeout(timer)
    }
  }, [metrics.leadSwapCount])

  // 50% when tied, toward 5% / 95% as one singer dominates.
  const sliderPercent = 50 + metrics.momentum * 45

  const leaderName = metrics.leaderPlayerId === player1Id ? p1Name : metrics.leaderPlayerId === player2Id ? p2Name : null
  const leaderColor = metrics.leaderPlayerId === player1Id ? player1Color : metrics.leaderPlayerId === player2Id ? player2Color : '#ffffff'

  return (
    <div
      data-testid="tug-of-war-bar"
      // A translucent fill, not a backdrop blur: the bar sits over playing
      // video for the whole song, and a blur re-samples it every frame.
      className={`relative flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-black/65 px-6 py-3.5 shadow-2xl ${className}`}
      style={{
        boxShadow: `0 10px 30px rgba(0,0,0,0.5), inset 0 0 40px ${leaderColor}15`,
      }}
    >
      <div className="flex w-full items-center justify-between text-xs font-bold">
        <div className="flex items-center gap-2" style={{ color: player1Color }}>
          <span className="h-2 w-2 rounded-full" style={{ background: player1Color }} />
          <span>{p1Name}</span>
          <span className="tabular-nums text-white/80">{s1.toLocaleString(language)}</span>
        </div>

        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait">
            {showLeadChange ? (
              <motion.span
                key="lead-change"
                initial={{ scale: 0.8, opacity: 0, y: -4 }}
                animate={{ scale: [1, 1.15, 1], opacity: 1, y: 0 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-extrabold text-black"
              >
                {t('duel.leadChange')}
              </motion.span>
            ) : metrics.leadDelta === 0 ? (
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/70">
                {t('duel.tied')}
              </span>
            ) : (
              <motion.span
                key="lead-delta"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold text-black"
                style={{ background: leaderColor }}
              >
                {t('duel.lead', { name: leaderName ?? '', points: metrics.leadDelta })}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2" style={{ color: player2Color }}>
          <span className="tabular-nums text-white/80">{s2.toLocaleString(language)}</span>
          <span>{p2Name}</span>
          <span className="h-2 w-2 rounded-full" style={{ background: player2Color }} />
        </div>
      </div>

      <div className="relative mt-2.5 h-3.5 w-full overflow-hidden rounded-full bg-white/10 border border-white/10 shadow-inner">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: `linear-gradient(to right, ${player1Color}, #ffffff 50%, ${player2Color})`,
          }}
        />

        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-white/60 z-10" />

        <motion.div
          className="absolute top-0 bottom-0 w-4 -translate-x-1/2 rounded-full bg-white z-20"
          animate={{ left: `${sliderPercent}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          style={{
            border: `2px solid ${leaderColor}`,
          }}
        />
      </div>
    </div>
  )
}
