import type { NoteKind, SongLine, SongNote } from '../../contracts/types'
import { flattenNotes } from '../matching/flattenNotes'
import { SCORING } from './constants'

/**
 * The party-karaoke/UltraStar scoring budget for ONE singer's part of ONE song.
 *
 * Every singer's maximum is the same fixed number (10,000): 9,000 shared out
 * over the notes of the part they actually sing, weighted by length (golden
 * beats count double), plus 1,000 shared equally over the lines that contain
 * anything scorable. Freestyle notes are worth nothing and take no share.
 *
 * Built from exactly the lines a singer's `Gameplay` lane is given, with the
 * same `flattenNotes` ids, so a perfect run of either duet part reaches
 * 10,000 -- not a fraction of the whole chart's notes.
 */
export interface LinePlan {
  /** Index into the `lines` array the plan was built from. */
  lineIndex: number
  /** Ids of this line's notes that carry points, in chart order. */
  scoredNoteIds: string[]
  /** Sum of `notePoints` over `scoredNoteIds` -- what a perfect line earns from notes. */
  maxNotePoints: number
  /** Line bonus a perfect line earns; 0 for a line with nothing scorable. */
  bonusPoints: number
}

export interface ScoringPlan {
  /** 10,000 when the part has anything scorable, else 0. */
  maxScore: number
  /** Exact (unrounded) points a fully-sung note is worth, by noteId. Scorable notes only. */
  notePoints: ReadonlyMap<string, number>
  /** Which entry of `lines` each note (scorable or not) belongs to. */
  lineIndexByNoteId: ReadonlyMap<string, number>
  lines: LinePlan[]
}

/** Freestyle is the only kind that is never scored. */
export function isScoredKind(kind: NoteKind): boolean {
  return kind !== 'freestyle'
}

/** Golden and golden-rap beats count double. */
export function isGoldenKind(kind: NoteKind): boolean {
  return kind === 'golden' || kind === 'goldenRap'
}

/** Rap notes are judged on voiced activity at any pitch, not on pitch. */
export function isRapKind(kind: NoteKind): boolean {
  return kind === 'rap' || kind === 'goldenRap'
}

/** A note's share of the note pool, in weighted beats. 0 for freestyle and degenerate lengths. */
export function noteWeight(note: Pick<SongNote, 'kind' | 'length'>): number {
  if (!isScoredKind(note.kind) || !(note.length > 0)) return 0
  return note.length * (isGoldenKind(note.kind) ? SCORING.goldenMultiplier : 1)
}

export function buildScoringPlan(lines: SongLine[]): ScoringPlan {
  const notes = flattenNotes(lines)
  const notePoints = new Map<string, number>()
  const lineIndexByNoteId = new Map<string, number>()

  let totalWeight = 0
  for (const note of notes) totalWeight += noteWeight(note)

  const planLines: LinePlan[] = []
  let cursor = 0
  lines.forEach((line, lineIndex) => {
    const plan: LinePlan = { lineIndex, scoredNoteIds: [], maxNotePoints: 0, bonusPoints: 0 }
    for (let i = 0; i < line.notes.length; i += 1) {
      const note = notes[cursor]
      cursor += 1
      lineIndexByNoteId.set(note.noteId, lineIndex)
      const weight = noteWeight(note)
      if (weight <= 0 || totalWeight <= 0) continue
      const points = (SCORING.notePool * weight) / totalWeight
      notePoints.set(note.noteId, points)
      plan.scoredNoteIds.push(note.noteId)
      plan.maxNotePoints += points
    }
    planLines.push(plan)
  })

  const bonusLines = planLines.filter((line) => line.maxNotePoints > 0)
  const bonusPerLine = bonusLines.length > 0 ? SCORING.linePool / bonusLines.length : 0
  for (const line of bonusLines) line.bonusPoints = bonusPerLine

  return {
    maxScore: totalWeight > 0 ? SCORING.notePool + SCORING.linePool : 0,
    notePoints,
    lineIndexByNoteId,
    lines: planLines,
  }
}
