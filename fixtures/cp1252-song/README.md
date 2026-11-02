# CP1252 chart fixture

`notes.txt` is a tiny, original German chart (invented artist, title and lyrics) saved in
**windows-1252** without an `#ENCODING` tag, CRLF line endings and comma decimals in `#BPM`/`#GAP`
(`212,5` / `1250,5`) -- the shape of many charts made with European-locale editors.

Tests use it to prove that both parsers decode its umlauts and the `’` (0x92, a CP1252-only byte)
instead of U+FFFD, agree on the result, and convert its comma-decimal timing correctly
(`src/stage/chart/__tests__/parserEquivalence.test.ts`, `src/stage/timing/__tests__/beatMs.test.ts`).

There is no audio; the `#MP3` file deliberately does not exist. Like the rest of the repo, this
fixture is MIT-licensed.

Keep the file's bytes as they are: re-saving it as UTF-8 defeats its purpose.
