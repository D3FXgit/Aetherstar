// Hz -> nearest 12-TET note name + cents-off, for the tuner needle/note text.
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface NoteNameResult {
  name: string
  cents: number
}

export function hzToNoteName(hz: number): NoteNameResult {
  const midi = 69 + 12 * Math.log2(hz / 440)
  const nearestMidi = Math.round(midi)
  const noteIndex = ((nearestMidi % 12) + 12) % 12
  const octave = Math.floor(nearestMidi / 12) - 1
  const cents = Math.round((midi - nearestMidi) * 100)

  return { name: `${NOTE_NAMES[noteIndex]}${octave}`, cents }
}
