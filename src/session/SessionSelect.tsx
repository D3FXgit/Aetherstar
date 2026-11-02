// `select` phase: the Song Selector, where picking a song advances the session.
import { SongSelector } from './SongSelector'
import { useSessionStore } from './sessionStore'

export function SessionSelect() {
  const pickSong = useSessionStore((state) => state.pickSong)
  return <SongSelector onSongPicked={pickSong} />
}
