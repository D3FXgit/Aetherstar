import { useT } from '../../i18n'
import type { Difficulty } from '../../calibration/types'
import type { LeaderboardEntry } from '../types'
import { TEXT, metaChipStyle, sectionLabelStyle, u } from './layout'

const DIFFICULTY_LABEL_KEYS: Record<Difficulty, string> = {
  easy: 'songSelect.difficulty.easy',
  normal: 'songSelect.difficulty.normal',
  hard: 'songSelect.difficulty.hard',
}

/**
 * The selected song's record on each difficulty and who holds it. Its height is
 * reserved, so the panel does not jump when the scores arrive.
 */
export function SongHighscores({ entries, players }: { entries: LeaderboardEntry[]; players: { id: string; name: string }[] }) {
  const t = useT()
  const best = entries.filter((entry, index) => entries.findIndex((other) => other.difficulty === entry.difficulty) === index)
  return (
    <div className="flex flex-col" style={{ marginTop: u(20), gap: u(8), minHeight: u(56) }} data-testid="song-highscores">
      <span style={sectionLabelStyle}>{t('songSelect.highscore.title')}</span>
      {best.length === 0 ? (
        <span style={{ fontSize: u(18), color: TEXT.secondary }}>{t('songSelect.highscore.none')}</span>
      ) : (
        best.map((entry) => (
          <div
            key={entry.difficulty ?? 'normal'}
            className="flex items-baseline"
            style={{ gap: u(10), fontSize: u(18) }}
            data-testid="song-highscore"
          >
            <span style={{ ...metaChipStyle, fontSize: u(14), padding: `${u(3)} ${u(8)}` }}>
              {t(DIFFICULTY_LABEL_KEYS[entry.difficulty ?? 'normal'])}
            </span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: TEXT.primary }}>
              {entry.score.toLocaleString()}
            </span>
            <span className="truncate" style={{ color: TEXT.secondary }}>
              {players.find((player) => player.id === entry.playerId)?.name ?? t('songSelect.highscore.unknownSinger')}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
