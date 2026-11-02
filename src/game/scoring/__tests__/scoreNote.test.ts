import { describe, expect, it } from 'vitest'
import type { NoteKind, SongLine, SongNote, SongPart } from '../../../contracts/types'
import { flattenNotes } from '../../matching/flattenNotes'
import { SCORING } from '../constants'
import { scoreNote } from '../scoreNote'
import { buildScoringPlan, isGoldenKind, isRapKind, isScoredKind, noteWeight } from '../scoringPlan'
import { createLineTracker } from '../lineRating'

function note(kind: NoteKind, startBeat: number, length: number): SongNote {
  return { kind, startBeat, length, pitch: 60, syllable: 'la' }
}

function line(part: SongPart, ...notes: SongNote[]): SongLine {
  return { part, notes }
}

/** Score a whole part as Gameplay does: per-note points, plus each line's bonus when its last note is judged. */
function playPart(lines: SongLine[], creditFor: (noteIndex: number) => number = () => 1): number {
  const plan = buildScoringPlan(lines)
  const tracker = createLineTracker(plan)
  let total = 0
  flattenNotes(lines).forEach((n, i) => {
    if (!isScoredKind(n.kind)) return
    const points = scoreNote(n, creditFor(i), plan)
    total += points
    total += tracker.record(n.noteId, points)?.bonusPoints ?? 0
  })
  return total
}

const DUET: SongLine[] = [
  line('p1', note('normal', 0, 4), note('golden', 4, 2)),
  line('p2', note('normal', 8, 1), note('normal', 9, 1), note('normal', 10, 1)),
  line('solo', note('normal', 12, 3), note('freestyle', 15, 8)),
  line('p1', note('rap', 24, 4), note('goldenRap', 28, 1)),
  line('p2', note('normal', 32, 16)),
]

const partLines = (part: 'p1' | 'p2') => DUET.filter((l) => l.part === part || l.part === 'solo')

describe('note kinds', () => {
  it('scores everything but freestyle; golden and golden rap count double; rap is pitch-free', () => {
    expect(isScoredKind('freestyle')).toBe(false)
    expect(['normal', 'golden', 'rap', 'goldenRap'].every((k) => isScoredKind(k as NoteKind))).toBe(true)
    expect(isGoldenKind('golden') && isGoldenKind('goldenRap')).toBe(true)
    expect(isRapKind('rap') && isRapKind('goldenRap') && !isRapKind('normal')).toBe(true)
  })

  it('weights a note by its length, golden beats double, freestyle nothing', () => {
    expect(noteWeight(note('normal', 0, 3))).toBe(3)
    expect(noteWeight(note('golden', 0, 3))).toBe(3 * SCORING.goldenMultiplier)
    expect(noteWeight(note('goldenRap', 0, 3))).toBe(6)
    expect(noteWeight(note('freestyle', 0, 3))).toBe(0)
    expect(noteWeight(note('normal', 0, 0))).toBe(0)
  })
})

describe('the 10,000 scale', () => {
  it('is 9,000 from notes and 1,000 from lines', () => {
    expect(SCORING.notePool + SCORING.linePool).toBe(SCORING.maxScore)
    expect(SCORING.maxScore).toBe(10_000)
  })

  it.each(['p1', 'p2'] as const)('a perfect run of duet part %s scores exactly 10,000', (part) => {
    expect(Math.round(playPart(partLines(part)))).toBe(10_000)
  })

  it('a perfect run of the whole chart as one part also scores exactly 10,000', () => {
    expect(Math.round(playPart(DUET))).toBe(10_000)
  })

  it('is the same ceiling for a short part and a long one', () => {
    const p1 = buildScoringPlan(partLines('p1'))
    const p2 = buildScoringPlan(partLines('p2'))
    expect(p1.maxScore).toBe(10_000)
    expect(p2.maxScore).toBe(10_000)
  })

  it('has no ceiling at all for a part with nothing scorable', () => {
    expect(buildScoringPlan([line('solo', note('freestyle', 0, 4))]).maxScore).toBe(0)
    expect(buildScoringPlan([]).maxScore).toBe(0)
  })

  it('silence scores 0', () => {
    expect(playPart(DUET, () => 0)).toBe(0)
  })
})

describe('note points', () => {
  it('shares the note pool by weighted beats: a golden beat is worth two normal ones', () => {
    const lines = [line('solo', note('normal', 0, 2), note('golden', 2, 2))]
    const plan = buildScoringPlan(lines)
    const [plain, golden] = flattenNotes(lines)
    expect(plan.notePoints.get(golden.noteId)).toBeCloseTo(2 * (plan.notePoints.get(plain.noteId) ?? 0), 9)
    expect((plan.notePoints.get(plain.noteId) ?? 0) + (plan.notePoints.get(golden.noteId) ?? 0)).toBeCloseTo(SCORING.notePool, 9)
  })

  it('excludes freestyle from the pool, so it neither earns nor dilutes', () => {
    const lines = [line('solo', note('normal', 0, 4), note('freestyle', 4, 100))]
    const plan = buildScoringPlan(lines)
    const [sung, free] = flattenNotes(lines)
    expect(plan.notePoints.get(sung.noteId)).toBeCloseTo(SCORING.notePool, 9)
    expect(plan.notePoints.has(free.noteId)).toBe(false)
    expect(scoreNote(free, 1, plan)).toBe(0)
  })

  it('scales a note\'s points with its per-beat credit, without a cliff', () => {
    const lines = [line('solo', note('normal', 0, 4))]
    const plan = buildScoringPlan(lines)
    const [only] = flattenNotes(lines)
    expect(scoreNote(only, 0.75, plan)).toBeCloseTo(0.75 * SCORING.notePool, 9)
    expect(scoreNote(only, 0.25, plan)).toBeCloseTo(0.25 * SCORING.notePool, 9)
  })

  it('clamps nonsense credit instead of minting points', () => {
    const lines = [line('solo', note('normal', 0, 4))]
    const plan = buildScoringPlan(lines)
    const [only] = flattenNotes(lines)
    expect(scoreNote(only, 2, plan)).toBeCloseTo(SCORING.notePool, 9)
    expect(scoreNote(only, -1, plan)).toBe(0)
    expect(scoreNote(only, Number.NaN, plan)).toBe(0)
  })

  it('has no combo: the same note pays the same whatever came before it', () => {
    const lines = [line('solo', note('normal', 0, 1), note('normal', 1, 1), note('normal', 2, 1))]
    const plan = buildScoringPlan(lines)
    const [a, b, c] = flattenNotes(lines)
    expect(scoreNote(c, 1, plan)).toBeCloseTo(scoreNote(a, 1, plan), 9)
    expect(scoreNote(b, 1, plan)).toBeCloseTo(scoreNote(a, 1, plan), 9)
  })
})

describe('line bonus', () => {
  it('shares the line pool equally over the lines with anything scorable', () => {
    const plan = buildScoringPlan([line('solo', note('normal', 0, 1)), line('solo', note('freestyle', 2, 1)), line('solo', note('normal', 4, 9))])
    expect(plan.lines.map((l) => l.bonusPoints)).toEqual([500, 0, 500])
  })

  it('pays a line its bonus in proportion to how much of it was sung', () => {
    const lines = [line('solo', note('normal', 0, 2), note('normal', 2, 2))]
    // Half the line sung: half the note pool, half the line bonus.
    expect(playPart(lines, (i) => (i === 0 ? 1 : 0))).toBeCloseTo(SCORING.notePool / 2 + SCORING.linePool / 2, 6)
  })
})
