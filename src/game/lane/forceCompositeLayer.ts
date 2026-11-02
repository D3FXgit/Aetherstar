/**
 * A framer-motion `transformTemplate` that appends `translateZ(0)` to whatever
 * transform the motion values produced.
 *
 * Why it is needed: framer-motion omits every transform axis still sitting at
 * its default, so an element driven by a single motion value renders as a bare
 * `translateX(...)` or `translateY(...)` and stays on the 2D path. Declaring
 * `z: 0` in `style` does not help -- 0 *is* the default, so it is dropped too.
 * A template is the only place the hint survives.
 *
 * Why it is used at all, given `will-change: transform` is already set: the two
 * hints fail in different ways. `will-change` is advisory and Chromium is free
 * to ignore or drop it under memory pressure; a 3D transform is a much harder
 * signal. Together they are what actually keep the two per-frame-moving
 * elements in a lane -- the note strip and the pitch line -- on their own
 * compositor layers for the whole song.
 *
 * Both hints are deliberately confined to those two elements. A promoted layer
 * holds VRAM for as long as it exists, and a lane stack is eight of them; the
 * static glass surfaces around them do not move and must not be promoted.
 */
export const forceCompositeLayer = (_latest: unknown, generated: string): string =>
  `${generated} translateZ(0)`
