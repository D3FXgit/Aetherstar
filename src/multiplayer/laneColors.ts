import { create } from 'zustand'

/**
 * The singers' colours, in lane order, while a song is on screen.
 *
 * Published by the gameplay overlay so the stage's lyric box can highlight in
 * the same colour as the lane and the score card, without the stage having to
 * know about mic slots.
 */
interface LaneColorsState {
  colors: readonly string[]
  setColors: (colors: readonly string[]) => void
}

const NONE: readonly string[] = []

export const useLaneColorsStore = create<LaneColorsState>((set, get) => ({
  colors: NONE,
  setColors: (colors) => {
    const current = get().colors
    if (current.length === colors.length && current.every((color, index) => color === colors[index])) return
    set({ colors: colors.length === 0 ? NONE : colors })
  },
}))
