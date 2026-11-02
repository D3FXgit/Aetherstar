# Menu music

The built-in menu track. By default the menus play random songs from the user's own library
(`src/audio/menuMusic.ts`); this loop is the **fallback** -- played when the library is empty, not
loaded, or every song tried fails to load -- and what plays when **Settings > Audio & Mics > Menu
music source** is set to **Built-in track**. When it plays, the Audio Manager
(`src/audio/audioManagerContract.ts`) loops it seamlessly on the menu-music bus, ducks it under
gameplay and stops it for a song preview. Imported in `src/audio/menuTrack.ts`.

## Origin and licence

**The menu music is original.** `menu_loop.wav` is synthesized from scratch by
[`scripts/generate-sound-assets.mjs`](../scripts/generate-sound-assets.mjs) -- no samples,
recordings or third-party material -- and is released under the repository's MIT licence together
with the code. Regenerate it (deterministically) with:

```sh
npm run generate:sounds                            # or: node scripts/generate-sound-assets.mjs
node scripts/generate-sound-assets.mjs menu_loop   # only the menu track
```

## `/menu_music/`

| File | Format | Notes |
| :--- | :--- | :--- |
| `menu_loop.wav` | WAV, 16-bit PCM mono, 22.05 kHz, ~3.3 MB | "Aether Lounge": calm synth-pop/lounge in D major, 100 BPM, 32 bars (76.8 s). Detuned saw pads, an e-piano arpeggio with echo, a soft sine/saw bass, light drums, and a flute-like lead over the middle two 8-bar sections (bars 25-28 are a half-time breakdown). |

The file is a seamless loop: exactly 32 bars long, with every note, echo and reverb tail that rings
past the loop end wrapped back onto its start (so the seam sounds like the next pass of the loop),
and rotated to open one 16th before the downbeat so the seam falls between notes rather than on a
kick. There is no silence at either end. `src/audio/__tests__/soundAssets.test.ts` checks the
length, size, edges and seam.

A replacement must also be loop-clean (no leading/trailing silence) and needs the import in
`src/audio/menuTrack.ts` updated if its name differs.
