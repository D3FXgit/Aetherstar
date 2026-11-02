import { describe, expect, it } from 'vitest'
import type { SongLine } from '../../../contracts/types'
import { createLineTracker, lineBonusPoints, lineRatingLabel, rateLine } from '../lineRating'
import { buildScoringPlan } from '../scoringPlan'
import { flattenNotes } from '../../matching/flattenNotes'

describe('rateLine', () => {
  it.each([
    [1, 'perfect'],
    [0.95, 'perfect'],
    [0.9, 'great'],
    [0.8, 'great'],
    [0.7, 'good'],
    [0.6, 'good'],
    [0.5, 'ok'],
    [0.4, 'ok'],
    [0.39, 'poor'],
    [0, 'poor'],
    [Number.NaN, 'poor'],
  ] as const)('rates %s of the line as %s', (fraction, rating) => {
    expect(rateLine(fraction)).toBe(rating)
  })

  it('labels the ratings party-karaoke-style, and says nothing for a poor line', () => {
    expect(lineRatingLabel('perfect')).toBe('Perfect!')
    expect(lineRatingLabel('great')).toBe('Great!')
    expect(lineRatingLabel('good')).toBe('Good')
    expect(lineRatingLabel('ok')).toBe('OK')
    expect(lineRatingLabel('poor')).toBeNull()
  })
})

describe('lineBonusPoints', () => {
  it('pays the full bonus for a perfect line and scales down from there', () => {
    expect(lineBonusPoints(1, 200)).toBe(200)
    expect(lineBonusPoints(0.5, 200)).toBe(100)
    expect(lineBonusPoints(0, 200)).toBe(0)
    expect(lineBonusPoints(3, 200)).toBe(200)
  })
})

describe('createLineTracker', () => {
  const lines: SongLine[] = [
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 2, pitch: 60, syllable: 'a' }, { kind: 'freestyle', startBeat: 2, length: 2, pitch: 60, syllable: 'b' }, { kind: 'normal', startBeat: 4, length: 2, pitch: 60, syllable: 'c' }] },
    { part: 'solo', notes: [{ kind: 'freestyle', startBeat: 8, length: 2, pitch: 60, syllable: 'd' }] },
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 12, length: 4, pitch: 60, syllable: 'e' }] },
  ]
  const plan = buildScoringPlan(lines)
  const [a, b, c, d, e] = flattenNotes(lines)

  it('completes a line on its last scorable note, rated by the share of its points earned', () => {
    const tracker = createLineTracker(plan)
    const pointsA = plan.notePoints.get(a.noteId) ?? 0

    expect(tracker.record(a.noteId, pointsA)).toBeNull()
    expect(tracker.record(b.noteId, 0)).toBeNull() // freestyle: not part of the line's score
    const done = tracker.record(c.noteId, 0)

    expect(done).not.toBeNull()
    expect(done!.lineIndex).toBe(0)
    expect(done!.fraction).toBeCloseTo(0.5, 9)
    expect(done!.rating).toBe('ok')
    expect(done!.bonusPoints).toBeCloseTo(plan.lines[0].bonusPoints / 2, 9)
  })

  it('never completes an all-freestyle line, and completes each line only once', () => {
    const tracker = createLineTracker(plan)
    expect(tracker.record(d.noteId, 0)).toBeNull()
    const full = plan.notePoints.get(e.noteId) ?? 0
    expect(tracker.record(e.noteId, full)?.rating).toBe('perfect')
    expect(tracker.record(e.noteId, full)).toBeNull()
  })
})
