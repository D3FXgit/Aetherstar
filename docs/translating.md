# Translating AetherStar

Every language AetherStar speaks is one plain text file. Add a file and the
language shows up in **Settings > Graphics > Language**. No coding, no build
step.

## Add a new language in five minutes

1. **Open your languages folder.** In AetherStar go to
   *Settings > Graphics > Language* and choose **Open languages folder**.
   (It lives in the app's user-data folder, e.g.
   `%APPDATA%\AetherStar\languages` on Windows,
   `~/Library/Application Support/AetherStar/languages` on macOS,
   `~/.config/AetherStar/languages` on Linux.)
2. **Copy `en.txt` into it.** You'll find it in the app's own `languages`
   folder (`resources/languages` next to the installed app) or in this
   repository's `languages/` folder.
3. **Rename the copy to your language code**: `fr.txt`, `es.txt`, `it.txt`,
   `pt-BR.txt`, ... The file name decides the language.
4. **Edit the header** at the top: set `@name:` to your language's name *in
   your language* (`@name: Français`). Change `@code:` to match the file name.
5. **Translate the right-hand side** of every `key = value` line. Never touch
   the key on the left.
6. **Save as UTF-8** and pick your language in Settings. AetherStar notices
   saved files while it is running; if it doesn't, restart it.

Anything you haven't translated yet simply shows in English, so you can ship a
half-finished file and fill it in over time. Settings tells you how many texts
are still missing.

## The file format

```text
@code: fr
@name: Français
@fallback: en

# Lines starting with # are comments. Blank lines are ignored.
settings.title = Paramètres
settings.mics.players.count.one   = {count} joueur dans ta liste.
settings.mics.players.count.other = {count} joueurs dans ta liste.
```

| Thing | Rule |
| --- | --- |
| Encoding | UTF-8 (with or without BOM). Any line ending works. |
| Entries | `key = value`, one per line. Only the first `=` splits; a `=` or `#` later in the value is just text. Spaces around key and value are trimmed. |
| Comments | Whole lines starting with `#`. There are no end-of-line comments. |
| `@code:` | The language code. The **file name wins** if they disagree (you'll get a warning in the log). |
| `@name:` | How the language is listed in Settings. Write it in the language itself. |
| `@fallback:` | Optional. Where missing texts come from *before* English. A regional file like `de-AT.txt` automatically falls back to `de` first, so you only need to write the lines that differ. |
| Line breaks | `\n` in a value is a line break, `\t` a tab, `\\` a backslash. |
| Placeholders | `{count}`, `{name}`, `{language}` ... are filled in by the game. Keep them exactly as written, but put them wherever your grammar needs them. Numbers are formatted for your language automatically (`12.345` in German). |
| Plurals | Same key plus a plural-form suffix: `.zero`, `.one`, `.two`, `.few`, `.many`, `.other` (the [Unicode CLDR plural categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)). Write the forms *your* language uses; `.other` is always needed. `.zero`, if present, is used for exactly 0. |
| Empty values | `key =` with nothing after it counts as "not translated" -- the English text is shown. |

Codes are a 2-3 letter language code, optionally with a region or script:
`de`, `fr`, `gsw`, `pt-BR`, `zh-Hant`.

## Tweaking a built-in language

A file in your languages folder with the **same name** as a built-in language
(for example `de.txt`) overrides it **line by line**: put only the lines you
want to change in it, and everything else still comes from the built-in file.
Updates to AetherStar never touch your folder.

## When something looks wrong

AetherStar never refuses a language file. A line it can't understand is
skipped and reported (with the file name and line number) in the app's log --
run it from a terminal to see `[i18n] fr.txt line 12: expected "key = value"`.
Common causes:

- a line without `=` (e.g. a value accidentally split over two lines -- use `\n`),
- a typo in the key (keys only use letters, digits, `_`, `-` and `.`),
- the same key twice (the later one wins).

Files in the folder that aren't named like a language (`README.txt`,
`notes.txt`, `._fr.txt`) are ignored.

## Contributing a translation back

Send your file as a pull request to `languages/<code>.txt` in this repository.
Every file in `languages/` is shipped with the app and compiled into the
renderer automatically -- no code change needed. Developers: see
[i18n-conventions.md](i18n-conventions.md).
