// Displayed duration, computed from the chart itself. Good enough for the song
// list; playback timing comes from the audio, not from this.
function computeDurationMs(chart) {
  // A chart with no/zero #BPM (real-world files sometimes omit or malform it)
  // would otherwise divide by zero here, producing Infinity/NaN -- a value
  // `songs.duration_ms NOT NULL` rejects outright, losing the whole song to a
  // thrown constraint error instead of just an inaccurate displayed duration.
  const msPerBeat = chart.meta.bpm > 0 ? 60000 / (chart.meta.bpm * 4) : 0

  let lastBeat = 0
  for (const line of chart.lines) {
    for (const note of line.notes) {
      const endBeat = note.startBeat + note.length
      if (endBeat > lastBeat) lastBeat = endBeat
    }
  }

  const durationMs = (chart.meta.gap || 0) + lastBeat * msPerBeat
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0
}

module.exports = { computeDurationMs }
