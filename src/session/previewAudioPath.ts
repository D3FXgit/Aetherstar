/**
 * Which file a song's preview should play.
 *
 * The full mix when the chart has one. Failing that the instrumental stem: a
 * stems-only chart (`#VOCALS`/`#INSTRUMENTAL` with no `#AUDIO`/`#MP3`) indexes
 * with `mp3Path: null` while still being fully playable, and previewing the
 * backing track is much closer to "what this song sounds like" than a bare
 * guide vocal with no accompaniment behind it.
 *
 * Returns null when there is nothing to play, so the caller starts no preview
 * rather than handing an empty URL to the audio engine.
 */
export function previewAudioPath(
  song: { mp3Path: string | null; instrumentalPath?: string | null } | null,
): string | null {
  if (!song) return null
  return song.mp3Path ?? song.instrumentalPath ?? null
}
