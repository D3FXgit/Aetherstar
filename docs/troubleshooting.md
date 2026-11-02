# Troubleshooting

Common problems and what to do about them. Settings paths below are written as
**Settings > Tab**.

## A song is missing from the song list

The song list only shows songs that can be played. A song is left out when:

- Its chart has no `#BPM`, or `#BPM` is not a number greater than 0. Such a chart can't be timed,
  so the song isn't added to the library at all. A comma decimal such as `326,9` is fine.
- Its chart has no notes.
- No audio file can be found. The app first looks for the file named in `#AUDIO` or `#MP3`. If
  that file is missing, it uses any audio file in the same folder.
- The `.txt` isn't recognised as a chart. It needs a `#TITLE` line plus at least one of `#BPM`,
  `#ARTIST`, `#MP3` or `#AUDIO`, all near the top of the file.

Once a folder has a chart, the scanner doesn't look inside its subfolders. Don't nest one song
folder inside another.

After fixing a song, open **Settings > Song Folders** and choose **Rescan** for that folder.

## No songs at all after adding a folder

Check that the folder holds song subfolders, each with its own `.txt` chart. Loose `.mp3` files
without charts are ignored. Then use **Rescan** in **Settings > Song Folders**.

## "Couldn't load this song"

Shown when a song's `.txt` chart can't be read as you start it. This usually means the file was
moved, renamed or deleted after the last scan. The message includes the reason. Restore the file
or rescan the folder, then pick the song again.

## "Couldn't load this song's media"

Shown when the song's audio can't be played: the file was moved or deleted after the last scan,
or it is in a format the app can't decode. Supported audio types are `.mp3`, `.ogg`, `.wav`,
`.m4a`, `.flac` and `.aac`. Put a working audio file back in the song folder and rescan.

## The video doesn't play, only the cover art

Only `.mp4` and `.webm` videos play. Many UltraStar songs use `.avi` or `.mpg`, which can't be
decoded, so the cover art is shown instead. Convert the video to `.mp4` and put it in the same
song folder. You don't need to edit the `#VIDEO` tag: the app picks the `.mp4` or `.webm` file in
the folder.

## "No input devices"

Shown on Mic Check and Calibration when no microphone is found. Plug one in and choose
**Rescan**. If a mic still doesn't show up, check that your operating system sees it as an input
device. **Settings > Audio & Mics** shows "No microphones detected." in the same case.

## "Microphone access needed" (macOS)

macOS asks for permission the first time the app uses a microphone. If access was denied, open
System Settings > Privacy & Security > Microphone, allow AetherStar, then choose **Retry** on Mic
Check. Windows and Linux don't show this screen.

## Notes are scored late

Run **Settings > Audio & Mics > Open Calibration**. It measures the delay of your speakers and
microphones. Run it again whenever you change audio hardware, especially Bluetooth or USB
devices.

If you calibrated your microphones with an earlier version of the app, run it again: the way mic
timing is measured has changed, so older microphone measurements were reset. Your speaker delay
and each singer's difficulty were kept.

## Scoring feels too strict or too easy

Each singer has their own difficulty, chosen on the **Who's singing?** screen just before the song
starts: Easy, Normal or Hard. The choice is remembered for next time, and Party mode, which picks
the singers itself, uses each singer's last choice. Easy accepts notes up to two semitones off, Normal one, and Hard only
the note itself. You can sing in any octave on every difficulty. Scores run from 0 to 10,000.

## The music drowns out the singers, or the other way round

Use the volume mixer at the top of **Settings > Audio & Mics**. It has separate sliders for
**Master**, **Music**, **Guide vocals** (songs with a separate vocal track), **Effects** and **Menu
music**. To hear the singers through the speakers, turn on **Hear the microphones** in the same
pane and set **Microphone level**.

## The menu plays my songs (or the wrong music)

By default the menus play random songs from your library, each for up to 90 seconds, starting at
the chorus where the song marks one (`#PREVIEWSTART`). The home screen shows which song is
playing. To change this, use **Menu music source** in **Settings > Audio & Mics**: **Built-in
track** plays the app's own loop, **Off** keeps the menus silent. The built-in track also plays
whenever the library is empty or its songs can't be loaded.

## Some songs are much louder than others

The app evens out song volume. Each song has to be measured once for this:

- **With ffmpeg installed**, songs are measured in the background after a scan. Install ffmpeg so
  it is on your `PATH`, or set the `AETHERSTAR_FFMPEG` environment variable to its full path. On
  macOS the usual Homebrew locations are found automatically. Then rescan your song folders.
  Levels settle in over a few minutes on a large library.
- **Without ffmpeg**, the app measures a song itself the first time you preview it in the song
  list (or it plays as menu music). A song you start without previewing it first plays at a cautious level and is measured
  after you've sung it, so it's right from the next time on.

Either way, the result is remembered, so each song is measured only once.

## The audience window doesn't appear

The audience window is off by default. Turn on **Second screen** in **Settings > Graphics**.

- With a second monitor, the window opens full screen on it. To choose a different monitor, pick
  it from the display list in the same panel.
- With only one monitor, it opens as a normal, resizable window on your main screen.

When you plug in or unplug a monitor, the window moves to the right screen on its own.

## Stuck in full screen

The app starts full screen. Turn on **Windowed mode** in **Settings > Graphics**. On macOS you can
also use the green button in the title bar (move the pointer to the top of the screen) or press
Control-Command-F. Esc does not leave full screen, because it is the Back key.
