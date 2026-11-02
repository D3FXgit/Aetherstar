// Client-side fuzzy layer over the library's song list.
import Fuse from 'fuse.js'
import type { LibrarySong } from './types'

const FUSE_OPTIONS = { keys: ['artist', 'title', 'edition'], threshold: 0.4 }

/**
 * One Fuse index per song list, keyed on the array itself.
 *
 * Building the index is the expensive part of a fuzzy search, and the list it
 * is built over only changes when the library or its filters do -- not on
 * every keystroke. The WeakMap lets an index die with the list it indexed.
 */
const indexBySongs = new WeakMap<LibrarySong[], Fuse<LibrarySong>>()

function indexFor(songs: LibrarySong[]): Fuse<LibrarySong> {
  let fuse = indexBySongs.get(songs)
  if (!fuse) {
    fuse = new Fuse(songs, FUSE_OPTIONS)
    indexBySongs.set(songs, fuse)
  }
  return fuse
}

export function fuzzyFilter(songs: LibrarySong[], query: string): LibrarySong[] {
  if (!query.trim()) return songs
  return indexFor(songs)
    .search(query)
    .map((result) => result.item)
}
