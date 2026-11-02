# Changelog

All notable changes to AetherStar are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-10-29

### Changed

- Smoother audio handover between the menu music and song previews in song selection.
- Switching between songs in song selection starts the new preview instantly.
- The results screen music plays louder, and the countdown sounds match the countdown more
  closely.
- The countdown is drawn in front of the note lanes.
- The player badge shows a concentric ring.
- Redesigned README with screenshots, a screen tour and a download guide.

## [1.1.0] - 2026-10-13

First public release.

### Added

- Party-karaoke-style scoring: 0 to 10,000 points per singer and song, split between notes, golden
  notes and a line bonus, with a final rank from Tone Deaf to Superstar.
- Line ratings: a Perfect, Great or Good verdict when each line ends, and a per-rating count on the
  results screen.
- Semitone tolerance per difficulty (Easy 2, Normal 1, Hard 0 semitones); singing in any octave
  counts.
- Line-paged note lanes: one line at a time with a sweeping playhead, and notes that fill in live
  as they are sung.
- Duets: `P1`/`P2` charts with each part assigned to its own singer, lyrics for both parts on
  screen.
- Pause menu during a song: resume, restart or quit to song selection.
- Jukebox mode with a transport bar (play/pause, previous/next, shuffle, repeat) and an editable
  "Up next" queue.
- Favourites, "recently sung" and "most sung" sorting, and per-song highscores shown in song
  selection and party mode.
- Difficulty chosen per singer on the singer-assignment screen and remembered for next time.
- Loudness normalization so songs play at a similar volume (measured with ffmpeg when available,
  otherwise on first preview), and a volume mixer for master, music, guide vocals, effects and menu
  music.
- Language packs as plain text files, with English and German included and user-added languages
  loaded from the user-data folder.
- Party mode: singers drawn fairly (least sung first) and a gallery of mystery songs to choose
  from, with each song's best score.
- An original demo song (*First Light*), sound effects and menu music, all generated from scripts
  in the repository.

### Changed

- Performance work in the native pitch engine, so several microphones at once run with lower CPU
  use.
- The menu music loops seamlessly; the anti-click edge fade now applies only to song previews.

### Security

- All windows run sandboxed with context isolation; the UI talks to the main process only through
  named preload functions.
- Song media is served through dedicated protocols limited to library folders and bundled assets.
- A strict Content-Security-Policy in release builds, and navigation away from the app is blocked;
  external links open in the system browser.

[Unreleased]: https://github.com/D3FXgit/AetherStar/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/D3FXgit/AetherStar/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/D3FXgit/AetherStar/releases/tag/v1.1.0
