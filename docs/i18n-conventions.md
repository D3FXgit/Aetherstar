# i18n conventions (for developers)

How to put a screen's text into the language files. The reference example is
everything under `src/settings/` -- copy what it does.

Translators' side of this (the file format, how to add a language):
[translating.md](translating.md).

## The moving parts

| Where | What |
| --- | --- |
| `languages/en.txt` | **The reference.** Every key exists here first. |
| `languages/de.txt` | German. Every key in `en.txt` must be here too (a test enforces it). |
| `<userData>/languages/*.txt` | The user's own languages and overrides. Not in the repo. |
| `src/i18n/` | `useT()`, `t()`, `setLanguage()`, the store. Import from `'../i18n'` (the index), never from a file inside it. |
| `electron/i18n/` | Main process: finds, parses and serves the files (`window.api.i18n`). |

## Using it in a component

```tsx
import { useT } from '../i18n'

export function SongSelectHeader({ songCount }: { songCount: number }) {
  const t = useT()
  return (
    <header>
      <h1>{t('songSelect.title')}</h1>
      <p>{t('songSelect.count', { count: songCount })}</p>
      <input placeholder={t('songSelect.search.placeholder')} aria-label={t('songSelect.search.label')} />
    </header>
  )
}
```

- **`useT()`** in components. The component re-renders when the language
  changes, so switching in Settings is live everywhere.
- **`t()`** (imported from `'../i18n'`) outside React: stores, event handlers,
  plain helpers. It does *not* re-render anything, so don't call it at module
  top level or cache its result -- the language can change later. Constant
  tables (tab lists, row definitions) store **keys** and translate at render
  time; see `SECTIONS` in `src/settings/Settings.tsx` and
  `src/settings/mixerRows.ts`.
- Translate **everything a person can read or hear**: visible text,
  `aria-label`, `title`, `placeholder`, `alt`, accessible names passed to
  primitives (`GlassToggle label=...`), toast/error messages.
- **Don't translate**: test ids, log messages, keys sent over IPC, file
  names, song metadata (titles and artists stay as the chart says), player
  names.

## Key naming

`screen.element.purpose`, camelCase segments, dots between them.

```text
songSelect.search.placeholder
songSelect.search.label
songSelect.empty.title
songSelect.empty.description
sing.pause.resume
results.score.label
common.cancel
```

- First segment = the screen or feature (`settings`, `songSelect`, `sing`,
  `results`, `players`, `micCheck`, `calibration`, `audience` ...). Match the
  scene / folder name.
- Then the element, then what the text is for: `.title`, `.label`,
  `.description`, `.action`, `.placeholder`, `.empty`, `.error`, `.hint`.
- `common.*` only for words that are genuinely the same everywhere (`Selected`,
  `Cancel`, `Back`). When in doubt, give the screen its own key -- the same
  English word often needs different translations in different places.
- Never rename a key casually: user translation files in the wild use it.
  If a text's *meaning* changes, add a new key and delete the old one.

## Adding keys -- both files, same place

1. Add the English line to `languages/en.txt` under the right section
   comment (or start a new `# --- Screen > Part ---` section).
2. Add the German line to `languages/de.txt` in the same position.
   `electron/i18n/__tests__/language-file.test.cjs` fails if `de.txt` is
   missing a key, or has one `en.txt` doesn't.
3. If a placeholder's meaning isn't obvious, add a `#` comment above the
   English line saying what fills it (`# {channel} is a mixer label, e.g. "Music"`).

## Placeholders, not concatenation

Word order differs between languages. Never build a sentence out of pieces.

```tsx
// Wrong -- German needs the name elsewhere, and "'s" is English-only.
`${player.name}'s turn`
t('sing.turn.prefix') + player.name

// Right
t('sing.turn', { name: player.name })   // en: {name}'s turn   de: {name} ist dran
```

Placeholders are `{name}` with letters, digits and `_`. Numbers passed as
numbers are formatted for the active language (`12345` -> `12,345` /
`12.345`); pass a string if you've already formatted it (a time, a score
string).

Laying out separate translated texts side by side is fine when they are
genuinely separate (a label and a value; two facts with a `·` between them --
see `SettingsLanguagePanel`). A *sentence* is always one key.

## Plurals

Pass a numeric `count`; write one line per plural form:

```text
songSelect.count.one   = {count} song
songSelect.count.other = {count} songs
```

```tsx
t('songSelect.count', { count: songs.length })
```

- The form is chosen with `Intl.PluralRules` for the active language, so
  Polish (`one/few/many/other`) and Japanese (`other` only) just work.
- `.other` is the catch-all; always write it.
- A real "nothing yet" state is usually a different sentence, not a plural:
  prefer a separate key (`songSelect.empty`) and a `count === 0 ? ... : ...` in
  the component. `.zero` exists for languages that grammatically need it.
- Never do `count === 1 ? 'song' : 'songs'` in code.

## Tone

AetherStar is a party game played from a sofa. Texts are read at a glance from
across the room.

- Short. One sentence for descriptions; labels are 1-3 words.
- Friendly and direct, second person ("Pick a song", not "The user may select
  a song").
- German uses **du** (casual, plural *ihr* when talking to the whole group),
  as party karaoke games usually do -- not *Sie*. Natural phrasing over literal
  translation ("Mikro" not "Mikrofoneingabegerät", "Boxen" for living-room
  speakers).
- No em-dashes in descriptions; no exclamation-mark spam.

## What happens when a key is missing

`t('x.y')` looks in the active language, then English, then returns the key
itself (`"x.y"`) so it is visible on screen rather than blank. In development
builds each missing key is logged once (`[i18n] unknown key "x.y"`). A key
showing up as dotted text on screen means it is missing from `en.txt`.

## Testing a converted screen

- Tests run without Electron; `src/i18n` then uses the language files compiled
  into the renderer. jsdom reports the system language as `en-US`, so tests
  see English by default and existing English assertions keep working.
- To test German: `await act(() => setLanguage('de'))`, and reset with
  `await setLanguage(null)` in `afterEach`. Example:
  `src/settings/__tests__/SettingsLanguagePanel.test.tsx`.
- To assert a text without repeating it, import `t` from `'../../i18n'`
  (see `src/settings/__tests__/SettingsVolumePanel.test.tsx`).

## Checklist for converting a screen

- [ ] Every human-readable string in the component (and its constant tables)
      goes through `t()` / `useT()` -- including `aria-label`, `placeholder`,
      `title`, `alt`, and labels passed to primitives.
- [ ] Keys follow `screen.element.purpose`; nothing reused across screens
      unless it's truly `common.*`.
- [ ] New keys added to **both** `languages/en.txt` and `languages/de.txt`, in
      the same section, with natural casual German (du-form).
- [ ] No string concatenation or template literals around translated text;
      variable parts are `{placeholders}`.
- [ ] Counts use plural keys (`.one` / `.other`), not `n === 1 ? ... : ...`.
- [ ] Constant tables store keys, translated at render time.
- [ ] Song titles, artists and player names are NOT translated.
- [ ] Existing tests still pass in English; at least one test switches to
      German if the screen has plurals or placeholders.
- [ ] `electron/i18n/__tests__/language-file.test.cjs` passes (en/de key sets
      match, both files parse without problems).
