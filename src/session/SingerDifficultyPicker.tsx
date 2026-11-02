// Per-singer Easy/Normal/Hard on Player Selection, drawn as a compact chip
// directly under the picked singer's badge. Written straight to the
// calibration store, which gameplay reads the pitch tolerance from and which
// persists it, so a singer's last choice is preselected next time.
//
// It used to be a stack of three-button rows above the Start button, which
// grew with every pick and pushed into (and on a short window over) the one
// action the screen is for. One focusable chip per singer instead lives inside
// that singer's grid cell, with its height reserved up front, so picking never
// moves anything and the footer is never in reach.
//
// One focus stop per singer, so couch navigation reads singer -> difficulty ->
// next singer -> Start: Down from a badge lands here. Left/Right -- keyboard
// or D-pad (via data-dpad-horizontal, src/input/spatialNavigation.ts) -- step
// the level and are swallowed, so they never wander off to a neighbour;
// A / Enter / a click cycle it; a mouse can also hit the arrows.
import { useEffect, type KeyboardEvent, type MouseEvent } from 'react'
import { difficultyForPlayer, useCalibrationStore } from '../calibration/calibrationStore'
import type { Difficulty } from '../calibration/types'
import { micColor } from '../design/tokens'
import { PRESS_CLASS } from '../design/motion'
import { useSfx } from '../audio/useSfx'
import { useT } from '../i18n'
import { DIFFICULTY_CHIP_MARGIN_TOP, SESSION_COLORS, TEXT, difficultyChipHeightFor } from './sessionTheme'

/** Easiest first: Left steps toward the start of this list, Right toward the end. */
const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'normal', 'hard']

const LABEL_KEYS: Record<Difficulty, string> = {
  easy: 'assign.difficulty.easy',
  normal: 'assign.difficulty.normal',
  hard: 'assign.difficulty.hard',
}

/** One step easier (-1) or harder (+1), stopping at either end. */
function stepDifficulty(current: Difficulty, delta: -1 | 1): Difficulty {
  const index = DIFFICULTY_ORDER.indexOf(current)
  const next = Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, index + delta))
  return DIFFICULTY_ORDER[next]!
}

/** The next level round the ring: what a press (A, Enter, a click) does. */
function cycleDifficulty(current: Difficulty): Difficulty {
  const index = DIFFICULTY_ORDER.indexOf(current)
  return DIFFICULTY_ORDER[(index + 1) % DIFFICULTY_ORDER.length]!
}

interface SingerDifficultyChipProps {
  playerId: string
  name: string
  /** 1-based mic this singer holds for the song; the chip wears its colour. */
  micNumber: number
  /** The badge edge this chip sits under; it matches its width. */
  badgeSize: number
}

export function SingerDifficultyChip({ playerId, name, micNumber, badgeSize }: SingerDifficultyChipProps) {
  const t = useT()
  const current = useCalibrationStore((state) => difficultyForPlayer(state.settings, playerId))
  const playSfx = useSfx((state) => state.play)
  const color = micColor(micNumber)
  const level = DIFFICULTY_ORDER.indexOf(current)
  const label = t(LABEL_KEYS[current])

  useEffect(() => {
    void useCalibrationStore.getState().ensureLoaded()
  }, [])

  const choose = (next: Difficulty) => {
    if (next === current) return
    playSfx('click')
    void useCalibrationStore.getState().setPlayerDifficulty(playerId, next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    // Claimed even at either end: the window-level couch navigation skips a
    // handled key, so focus stays put instead of jumping to a neighbour.
    event.preventDefault()
    choose(stepDifficulty(current, event.key === 'ArrowLeft' ? -1 : 1))
  }

  /** The arrows are mouse targets only; the keyboard and pad use the chip itself. */
  const onArrow = (delta: -1 | 1) => (event: MouseEvent) => {
    event.stopPropagation()
    choose(stepDifficulty(current, delta))
  }

  const height = difficultyChipHeightFor(badgeSize)
  const fontSize = Math.max(13, Math.round(badgeSize * 0.07))
  const arrowWidth = Math.max(22, Math.round(height * 0.6))
  const pipWidth = Math.max(8, Math.round(fontSize * 0.7))

  const arrowStyle = (enabled: boolean) =>
    ({
      width: arrowWidth,
      alignSelf: 'stretch',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: Math.round(fontSize * 1.15),
      color: enabled ? color : TEXT.tertiary,
      opacity: enabled ? 1 : 0.4,
    }) as const

  return (
    <button
      type="button"
      data-testid={`singer-difficulty-${playerId}`}
      data-difficulty={current}
      // The pad's Left/Right reach onKeyDown below as keys, like the keyboard's.
      data-dpad-horizontal="adjust"
      aria-label={t('assign.difficulty.chip', { name, level: label })}
      title={t('assign.difficulty.hint')}
      onClick={() => choose(cycleDifficulty(current))}
      onKeyDown={onKeyDown}
      className={`flex items-center justify-between ${PRESS_CLASS}`}
      style={{
        width: badgeSize,
        height,
        marginTop: DIFFICULTY_CHIP_MARGIN_TOP,
        padding: 0,
        borderRadius: 999,
        border: `2px solid ${color}`,
        background: SESSION_COLORS.raised,
        color: TEXT.primary,
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden="true"
        data-testid="singer-difficulty-easier"
        title={t('assign.difficulty.easier')}
        onClick={onArrow(-1)}
        style={arrowStyle(level > 0)}
      >
        ‹
      </span>
      <span className="flex min-w-0 flex-col items-center" style={{ gap: 3 }}>
        <span className="truncate" style={{ fontSize, fontWeight: 800, lineHeight: 1.05, maxWidth: '100%' }}>
          {label}
        </span>
        {/* A level meter, so the choice reads before the word does. */}
        <span aria-hidden="true" className="flex" style={{ gap: 3 }}>
          {DIFFICULTY_ORDER.map((option, index) => (
            <span
              key={option}
              style={{
                width: pipWidth,
                height: 4,
                borderRadius: 2,
                background: index <= level ? color : SESSION_COLORS.line,
              }}
            />
          ))}
        </span>
      </span>
      <span
        aria-hidden="true"
        data-testid="singer-difficulty-harder"
        title={t('assign.difficulty.harder')}
        onClick={onArrow(1)}
        style={arrowStyle(level < DIFFICULTY_ORDER.length - 1)}
      >
        ›
      </span>
    </button>
  )
}
