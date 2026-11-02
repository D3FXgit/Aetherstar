# Demo song: AetherStar -- *First Light*

The app's built-in sample song. Electron serves `notes.txt` as the fixture chart
(`STAGE_GET_FIXTURE_CHART_PATH` in `electron/main.cjs`), so it is what the Sing scene, the
calibration wizard and the dev labs play, and many tests read it.

**Everything in this folder is original and MIT-licensed like the rest of the repository.** The
lyrics and melody were written for AetherStar; the audio and the cover are synthesized from scratch
by [`scripts/generate-demo-audio.mjs`](../../scripts/generate-demo-audio.mjs) -- no samples, no
third-party recordings, no fonts or images.

| File | What it is |
| --- | --- |
| `notes.txt` | The UltraStar chart (format 1.1.0): `#BPM:120`, `#GAP:6000`, 9 lines, ~48 s |
| `instrumental.wav` | Backing track: pad, bass, drums, count-in clicks and an arpeggio break. Mono 22.05 kHz 16-bit. Tagged `#AUDIO`/`#MP3` and `#INSTRUMENTAL` -- the karaoke mix *is* the backing track, so the song still plays if the vocal stem is missing |
| `vocals.wav` | Guide melody following every note of the chart, as a separate stem (`#VOCALS`) so the guide-vocal fader can duck it. Mono 8 kHz 16-bit |
| `cover.png` | 400x400 dawn gradient with a star (`#COVER`) |

The chart deliberately exercises every note kind: normal notes, golden notes (`*`, "ring",
"page"), a rap line (`R`, ending on a golden rap `G`, "tight"), a freestyle note (`F`, "Ooh"),
line breaks, and a 4-second instrumental break between "sing" and the rap. The first line starts
6 s in, after a three-bar intro with a four-click count-in.

## Regenerating

Edit `notes.txt` (and the chord table in the script if the harmony changes), then run:

```sh
node scripts/generate-demo-audio.mjs        # instrumental.wav, vocals.wav, cover.png
node scripts/generate-gameplay-traces.mjs   # fixtures/gameplay-traces/{perfect,silence}.json
```

Both scripts are deterministic. Tests assert concrete values from this chart (artist, title, tags,
the first note, line count, duration), so update them alongside any chart change.
