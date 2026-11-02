# Contributing to AetherStar

Thanks for helping. Bug reports, translations, fixes and features are all welcome. For anything
larger than a small fix, open an issue first so we can agree on the approach before you spend time
on it.

## The one hard rule

**Never commit copyrighted songs, lyrics, cover art, videos or music.** That includes "just for
testing". AetherStar ships no third-party media. Test charts must be invented, and audio must be
generated (see `scripts/generate-demo-audio.mjs` and `scripts/generate-sound-assets.mjs`) or your
own work released under the MIT license. Pull requests that add third-party media will be closed.

## Setup

You need Node.js 22.12+, Rust stable and your platform's C/C++ build tools (see
[Building from source](README.md#building-from-source)).

```bash
npm ci
npm run dev
```

## Checks

Run these before opening a pull request. CI runs the same on Windows, macOS and Linux.

```bash
npm run lint
npm run typecheck
npm test
cargo test --manifest-path native/Cargo.toml
```

`npm test` needs the plain-Node build of `better-sqlite3`. `npm run dev`, `start`, `package` and
`dist` rebuild it for Electron and then back for Node; if a run was interrupted and the tests
complain that better-sqlite3 could not be loaded, run `npm run rebuild:node`.

Tests live next to the code in `__tests__/` folders. Add or update tests with every change in
behaviour. Tests must not need a microphone, network access or a real song library: use the fake
audio bridge in `electron/audio/test-helpers/` and the charts in `fixtures/`.

## Code style

- TypeScript for the UI (`src/`), CommonJS for the Electron main process (`electron/`), Rust for
  the native module (`native/`).
- ESLint and `tsc` must pass with no errors. Format Rust with `cargo fmt`.
- Keep the security model intact: the UI talks to the main process only through named functions in
  `electron/preload.cjs`. Add a named channel in `electron/ipc-registry.cjs` for a new call; never
  expose a generic `invoke(channel, ...)` or `ipcRenderer`.
- Comments explain why, not what. Keep them in plain English.
- Files are UTF-8 with LF line endings (enforced by `.gitattributes`).

## Text and translations

Every text the player sees comes from the language files in `languages/`. Don't hard-code UI
strings. Add the key to `languages/en.txt` (and `de.txt` if you can), following
[docs/i18n-conventions.md](docs/i18n-conventions.md). To add a whole language, see
[docs/translating.md](docs/translating.md).

## Pull request checklist

- [ ] Lint, typecheck, `npm test` and `cargo test` pass locally.
- [ ] New behaviour has tests.
- [ ] New UI text is in `languages/en.txt` (and `de.txt` where possible).
- [ ] Docs (README, `docs/`) and `CHANGELOG.md` (under "Unreleased") are updated if users will
      notice the change.
- [ ] No copyrighted songs, lyrics, cover art, videos or music are included.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
