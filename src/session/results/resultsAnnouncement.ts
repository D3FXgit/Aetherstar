// The whole result as spoken text: what a screen reader hears instead of
// sitting through the celebration.
import type { TFunction } from '../../i18n'
import { rankTitleKey } from '../rating'
import type { ResultSinger } from './singers'

export function resultsAnnouncement(t: TFunction, winner: ResultSinger, others: readonly ResultSinger[]): string {
  const rank = (singer: ResultSinger) => t(rankTitleKey(singer.rating.title))
  const parts = [
    t('results.announce.winner', { name: winner.name, score: winner.result.score, mic: winner.micSlot + 1 }),
    t('results.announce.rating', { rank: rank(winner), count: winner.rating.stars }),
  ]
  if (winner.newHighscore) parts.push(t('results.highscore'))
  if (others.length > 0) {
    const list = others
      .map((singer) =>
        t(singer.newHighscore ? 'results.announce.otherWithHighscore' : 'results.announce.other', {
          name: singer.name,
          score: singer.result.score,
          rank: rank(singer),
        }),
      )
      .join('; ')
    parts.push(t('results.announce.others', { list }))
  }
  return parts.join(' ')
}
