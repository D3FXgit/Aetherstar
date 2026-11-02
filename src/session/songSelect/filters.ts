// Pure helpers behind the selector's filters and sort chip.
import type { LibrarySong, LibrarySortOrder } from '../../library/types'

/** The order the sort chip cycles through. */
export const SORT_ORDERS: LibrarySortOrder[] = ['artist', 'title', 'recent', 'recentlySung', 'mostSung']

/** i18n keys for each sort order's name. */
export const SORT_LABEL_KEYS: Record<LibrarySortOrder, string> = {
  artist: 'songSelect.sort.artist',
  title: 'songSelect.sort.title',
  recent: 'songSelect.sort.recent',
  recentlySung: 'songSelect.sort.recentlySung',
  mostSung: 'songSelect.sort.mostSung',
}

/** The value after `current` in `values`, wrapping through `undefined` (no filter). */
export function nextInCycle<T>(values: T[], current: T | undefined): T | undefined {
  if (current === undefined) return values[0]
  const index = values.indexOf(current)
  return index === -1 || index === values.length - 1 ? undefined : values[index + 1]
}

/** Every language tagged in `songs`, alphabetically. */
export function distinctLanguages(songs: LibrarySong[]): string[] {
  const languages = new Set<string>()
  for (const song of songs) if (song.language) languages.add(song.language)
  return [...languages].sort((a, b) => a.localeCompare(b))
}

/** The jump-nav letter a song files under. */
export function letterOf(song: LibrarySong): string {
  return song.title.charAt(0).toUpperCase() || '#'
}

/** Letter -> number of songs, alphabetically. */
export function letterCounts(songs: LibrarySong[]): [string, number][] {
  const map = new Map<string, number>()
  for (const song of songs) {
    const letter = letterOf(song)
    map.set(letter, (map.get(letter) ?? 0) + 1)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** A deterministic Fisher-Yates shuffle: the same seed gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items]
  let state = seed
  for (let i = shuffled.length - 1; i > 0; i--) {
    state = (state * 9301 + 49297) % 233280
    const j = Math.floor((state / 233280) * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
