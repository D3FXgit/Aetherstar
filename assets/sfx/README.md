# Sound effect assets

Every one-shot UI/gameplay sound the app plays. Registered in
`src/audio/sfxAssets.ts` (Vite static imports, fingerprinted by `vite build`,
no Electron main-process involvement) and named in `src/audio/sfxContract.ts`.

## Origin and licence

**All audio in this folder is original.** Every file is synthesized from
scratch by [`scripts/generate-sound-assets.mjs`](../../scripts/generate-sound-assets.mjs)
(oscillators, FM, seeded noise, envelopes, filters and a small reverb -- no
samples, recordings or third-party material) and is released under the
repository's MIT licence together with the code.

To regenerate (deterministic -- the same script always writes the same bytes):

```sh
npm run generate:sounds                          # or: node scripts/generate-sound-assets.mjs
node scripts/generate-sound-assets.mjs --check   # verify the committed files match the script
node scripts/generate-sound-assets.mjs ui_click  # rebuild only matching files
```

All files are 16-bit PCM WAV at 44.1 kHz: mono, except the song-start trio
(`song_selected.wav`, `countdown_beep.wav`, `countdown_go.wav`), which is one
wide stereo piece of music.
`src/audio/__tests__/soundAssets.test.ts` checks that every file here is one the
script produces.

**To swap a sound: drop a new file in with the same filename** (no code change),
or change its recipe in the script and regenerate. Anything prefixed
`placeholder_` is a deliberately simple stand-in that may be redesigned later.

| File | Duration | Sound | Used for |
| :--- | :--- | :--- | :--- |
| `song_selected.wav` | 4.75s | Stereo, F major. A gated stutter fill (snare + Ebmaj7 stabs, kicks) into the main hit at ~300 ms: kick, crash, a wide detuned-saw F(add9) chord over an F1/F2 bass and a falling pluck cascade (A6-G6-F6-C6-Bb5-F5-C5) with ping-pong echoes. The chord moves F - Eb - F, a snare fill leads into tick "3", a build over a C pedal with Ab - Bb - C stabs sits under "2", and "1" brings a C7 chord with an 808 sub drop (~130 Hz down to ~17 Hz) that falls away to near silence before "go" | The zoom transition from player assignment into the song. Its length (4750 ms) and attack (loudest at 300 ms, silent until 45 ms) are constants in `sfxAssets.ts`, checked by `soundAssets.test.ts` -- a replacement of a different shape needs those updated. |
| `ui_hover.wav` | 60ms | Soft high tick | Focusing/hovering a menu item or song card |
| `ui_click.wav` | 90ms | Short pitched click with a little body | Clicking a button |
| `ui_confirm.wav` | 420ms | Two-note e-piano chime, A5 rising to E6 | A larger confirm (picking a song, saving a setting) |
| `ui_back.wav` | 200ms | Soft downward noise whoosh | Navigating back / closing a panel |
| `ui_error.wav` | 280ms | Two low filtered buzzes ("uh-uh") | A blocked or invalid action |
| `countdown_beep.wav` | 917ms | Stereo: a soft-attack C5 beep (~20 ms in) whose bright G6 overtone rings on after it, with a breath of air, very wide (detuned side signal, ping-pong echoes, short room) | Each 3-2-1 pre-song countdown tick (and the resume lead-in after a pause) |
| `countdown_go.wav` | 1.25s | Stereo: an instant, bright C6 with a strong C8 two octaves up and a glassy high sparkle, extremely wide, ~1.3 s room | The moment the song starts |
| `placeholder_hit_excellent.wav` | 280ms | Bright E6 + B6 bell pluck, peak -21 dBFS | An `epic` note judgement |
| `placeholder_hit_good.wav` | 160ms | Short G5 pluck, peak -25.6 dBFS | A `good` note judgement |
| `placeholder_hit_bad.wav` | 200ms | Dull, falling detuned thud, peak -26.5 dBFS | An `awful` note judgement |
| `placeholder_hit_golden.wav` | 740ms | Ascending C major arpeggio (C5/C6-E6-G6-C7) with a high sparkle transient, peak -18 dBFS | Clearing a **golden** note (the chart's double-points note). Plays *instead of* the tier sound, so it is never heard on top of one. Deliberately the longest and hottest of the four hit sounds -- it is the rarest good thing that happens in a song and it has to sound like it. |
| `placeholder_cheer.wav` | 2.6s | Synthetic crowd swell (formant-filtered voices), claps and two whistles | Crowd cheer as the winner's crown lands |
| `placeholder_crown_land.wav` | 900ms | Low impact thump plus a shimmering C major bell chord | The crown impact itself |
| `placeholder_score_tick.wav` | 35ms | Tiny C7 blip, peak -24 dBFS | Each step of the rolling score counter -- fires rapidly, so it is deliberately quiet |
| `ui_bing.wav` | 500ms | E6 bell | Results actions fading in |
| `ui_bong.wav` | 600ms | Softer A5 bell with an A4 body | Lower-pitched partner to `ui_bing` |
