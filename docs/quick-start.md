# Quick Start

This guide takes you from a fresh install to your first song.

## 1. Install and run

Download the installer for your system from the
[Releases page](https://github.com/D3FXgit/AetherStar/releases) and install it. The builds are not
code-signed; the [README](../README.md#download-and-install) explains how to get past the Windows
SmartScreen and macOS Gatekeeper warnings.

To run from source instead, you need Node.js 22.12+, a Rust toolchain and your platform's build
tools (see [Building from source](../README.md#building-from-source)):

```bash
npm ci
npm run dev
```

The app opens on the Home screen. It has two buttons, **Start a night** and **Settings**. The line
under them shows how many microphones the app found.

## 2. Add your songs

AetherStar does not come with songs. You need a folder of UltraStar songs, with one subfolder per
song (a `.txt` chart plus its audio, and optionally a video and cover).

1. Open **Settings > Song Folders**.
2. Choose **Add a folder** and pick the top folder of your songs.
3. The app scans it, subfolders included. Use **Rescan** later if you add or change songs.

You can also add a folder from the song list. If no songs are set up yet, it shows an **Add library
folder** button.

## 3. Set up your microphones

Open **Settings > Audio & Mics**.

- **Microphones** lists Mic 1 to Mic 8. Give each one a device and, for an audio interface, a
  channel. Sing into a mic and its level bar moves, so you can tell which is which.
- **Open Mic Check** shows a live tuner for each input. Use it to make sure your voice is picked up.
- **Open Calibration** runs a short wizard that measures the delay of your speakers and microphone.
  Run it once per setup, especially with Bluetooth or USB audio. Without it, notes can be scored a
  little late.
- **Manage players** opens the roster. Add a player for each singer, with a name and an optional
  photo. Scores are saved per player.

## 4. Sing

1. On Home, choose **Start a night**.
2. **Pick a song.** The tabs at the top choose the mode:
   - **Solo/Duet**: one singer, or two on a duet song.
   - **Versus**: several singers sing the same song against each other.
   - **Party**: the app picks the singers and offers three songs. Singers who have sung least are
     picked first.
3. **Assign singers** (the **Who's singing?** screen). Choose who is singing, which mic each person uses, and each singer's
   difficulty: Easy, Normal or Hard. Then choose **Start singing**.
4. **Sing.** After a short countdown the song starts. Notes are shown one line at a time, and a
   playhead sweeps across the line. You can sing in any octave. Press Esc to pause or leave the song.
5. **Results.** Each singer gets a score out of 10,000 and a rank, from Tone Deaf up to Superstar.
   From here you can choose a new song, open the leaderboard, or leave.

## 5. Optional settings

- **Settings > Audio & Mics** also has the volume mixer, and **Hear the microphones** if you want
  the mics played through the speakers. Under the mixer, **Menu music source** picks what plays on
  the menus: **Songs from your library** (the default: random songs, with the title on the home
  screen), **Built-in track**, or **Off**.
- **Settings > Graphics** has **Windowed mode** (the app starts full screen), **Second screen** for
  the audience window on another monitor, and **Reduce effects** for slower computers.

If something doesn't work, see [Troubleshooting](./troubleshooting.md).
