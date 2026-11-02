# UI image assets

Bitmap artwork the renderer draws directly. Registered in
`src/session/resultsAssets.ts` (Vite static imports, fingerprinted by
`vite build`, no Electron main-process involvement) — the same arrangement
`assets/sfx/` uses for sound.

**To swap an image: drop a new file in with the same filename.** No code change.

| File | Size | Format | Used for |
| :--- | :--- | :--- | :--- |
| `crown.png` | 864 × 600 | PNG-32, straight (non-premultiplied) alpha, transparent background | The crown that falls onto the winner on the results screen (beat 2 of the celebration — see `src/session/resultsChoreography.ts`). **Placeholder**, generated from the SVG below; meant to be replaced. |

## What a replacement needs

* **Transparency.** PNG-32 with a real alpha channel and a fully transparent
  background. The crown lands over the winner's avatar, so anything opaque
  behind the artwork will be a visible rectangle on the one element of the
  screen everybody in the room is looking at.
* **Dimensions: 864 × 600, or any larger multiple of the same 72:50 art box.**
  The crown is drawn at 86 design units wide, which is 86 px on a 1080p display
  and 172 px on a 4K one; 864 px of source is ~5× that, which leaves headroom
  for a Retina/HiDPI panel and for the impact squash briefly scaling it up.
  Smaller than about 344 px wide will visibly soften on a 4K television.
* **Margins.** The placeholder leaves a little transparent padding inside the
  canvas (the artwork occupies roughly 94% of the width and 82% of the height),
  which is what makes the crown sit at the height it does above the badge. Art
  bled hard to the canvas edges will land a few units lower and read slightly
  larger.
* **Aspect ratio.** The image is placed in a fixed 86 × 60 unit box with
  `object-fit: contain`, so a differently-proportioned replacement is fitted
  inside that box rather than stretched — it will simply be smaller on one axis.
  Keeping to 72:50 uses the whole box.

The landing animation, its 420 ms flight and the `crownLand` / `cheer` cues are
timed against that box and do not change when the file does.

## Regenerating the placeholder

The placeholder is a rasterised copy of the SVG that used to be drawn inline in
`SessionResults.tsx`, with the app's `oklch()` accent tokens converted to sRGB
hex. ImageMagick (`convert`) rasterises it; `ffmpeg` cannot — it has an SVG
demuxer but no SVG decoder on this platform.

```sh
cat > crown.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="864" height="600" viewBox="0 0 72 50">
  <path d="M6 44 L3 11 L20 25 L36 5 L52 25 L69 11 L66 44 Z"
        fill="#fdc436" stroke="#ffeda8" stroke-width="2" stroke-linejoin="round"/>
  <path d="M6 38 H66" stroke="#bb7400" stroke-width="2.5"/>
  <circle cx="36" cy="20" r="4" fill="#ff6661"/>
  <circle cx="17" cy="33" r="2.6" fill="#00dadd"/>
  <circle cx="55" cy="33" r="2.6" fill="#ec8aff"/>
</svg>
EOF
convert -background none crown.svg PNG32:crown.png
```
