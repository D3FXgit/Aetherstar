import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_BACKDROP_BLUR_PX, tokens } from '../tokens'

/**
 * The app-wide backdrop-blur budget, enforced statically.
 *
 * A blur costs device-pixel area x radius and every glass surface here sits
 * over playing video, so it is re-run every frame. Measured on an M3 Max over
 * the singer view: 44/40/24px radii 41 fps, capped at 12px 48 fps, no
 * backdrop-filter 119 fps. Radius is a weak lever; the NUMBER of blurred
 * surfaces is the strong one. Menus are solid, so blur belongs only to the few
 * glass overlays on video.
 */

// Vitest runs from the repo root (vite.config's root), and `import.meta.url` is
// not a file: URL under the jsdom environment -- so the tree is located from the
// working directory rather than from this module.
const SRC = join(process.cwd(), 'src')

/**
 * Tailwind v4's named backdrop-blur scale, in px. Listed so a named utility is
 * measured against the same budget as an arbitrary `[Npx]` one -- otherwise
 * `backdrop-blur-2xl` would be a silent 40px hole in the cap.
 */
const NAMED_BLUR_PX: Record<string, number> = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 40,
  '3xl': 64,
  none: 0,
}

/** Files allowed over the cap. Empty, and it should stay that way. */
const OVER_BUDGET_ALLOWLIST = new Set<string>([])

/**
 * Upper bound on statically findable blur surfaces in src/. Lower it whenever
 * a removal lands; raising it is a design decision to argue for.
 */
const MAX_LIVE_BLUR_SURFACES = 4

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    // `._*` entries are macOS resource-fork droppings, not source.
    if (entry.startsWith('._')) continue
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, out)
    } else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

interface BlurUse {
  file: string
  radiusPx: number
  source: string
}

/**
 * Every statically knowable blur radius in a file, comments stripped first (a
 * comment about an old radius is not a live surface). A `blur(${expr}px)`
 * interpolation is skipped: its value is a token, asserted directly below.
 * `//` counts as a comment only when not preceded by `:`, so URLs survive.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function blurUses(file: string): BlurUse[] {
  const text = stripComments(readFileSync(file, 'utf8'))
  // Forward slashes on every platform, so the file names below match on Windows too.
  const rel = relative(SRC, file).replace(/\\/g, '/')
  const uses: BlurUse[] = []

  for (const match of text.matchAll(/backdrop-blur-\[(\d+(?:\.\d+)?)px\]/g)) {
    uses.push({ file: rel, radiusPx: Number(match[1]), source: match[0] })
  }
  for (const match of text.matchAll(/backdrop-blur-(xs|sm|md|lg|xl|2xl|3xl|none)\b/g)) {
    uses.push({ file: rel, radiusPx: NAMED_BLUR_PX[match[1]], source: match[0] })
  }
  // backdropFilter / WebkitBackdropFilter written as an inline style string.
  for (const match of text.matchAll(/[Bb]ackdropFilter:\s*[`'"][^`'"]*?blur\((\d+(?:\.\d+)?)px\)/g)) {
    uses.push({ file: rel, radiusPx: Number(match[1]), source: match[0].trim() })
  }

  return uses
}

const ALL_USES = sourceFiles(SRC).flatMap(blurUses)

describe('backdrop-blur budget', () => {
  // Anchored on the one surface that must always exist -- the shared glass
  // class -- rather than on a count: blur surfaces are being removed from the
  // app on purpose, and a "more than N" sanity check would turn each removal
  // into a failure.
  it('finds the blur surfaces it is meant to be policing (guard against a regex that matches nothing)', () => {
    expect(ALL_USES.some((use) => use.file === 'design/tokens.ts' && use.radiusPx === MAX_BACKDROP_BLUR_PX)).toBe(true)
  })

  // The strong lever is the *number* of live blur surfaces, so the count is a
  // ratchet: an upper bound that removals pass under freely and that only a
  // deliberate edit here can raise.
  it('never grows the number of live blur surfaces past the ratchet', () => {
    expect(ALL_USES.length).toBeLessThanOrEqual(MAX_LIVE_BLUR_SURFACES)
  })

  // The audience window is nothing *but* a surface over the song's video, so
  // every blur in it is re-run every frame on the TV. None, by rule -- a
  // translucent fill does the separating job for free.
  it('uses no backdrop-filter anywhere in the audience window', () => {
    const audienceUses = ALL_USES.filter((use) => use.file.startsWith('audience/'))
    expect(audienceUses.map((use) => `${use.file}: ${use.source}`)).toEqual([])
  })

  it('keeps every blur surface outside the allowlist at or under the cap', () => {
    const overBudget = ALL_USES.filter(
      (use) => use.radiusPx > MAX_BACKDROP_BLUR_PX && !OVER_BUDGET_ALLOWLIST.has(use.file),
    )

    expect(
      overBudget.map((use) => `${use.file}: ${use.source} (${use.radiusPx}px > ${MAX_BACKDROP_BLUR_PX}px)`),
    ).toEqual([])
  })

  // The surfaces that composite over *playing video* every frame of every
  // song -- the ones that made an M3 Max drop frames. Named individually so the
  // allowlist above can never be widened to cover them by accident. (A file
  // that has dropped its blur entirely passes trivially; that is the goal.)
  it.each([
    // The largest surface in the app, sitting over playing video for the whole
    // song. A live blur under it is exactly the thing this budget exists to
    // prevent -- removing the 44px one it used to carry was the single biggest
    // win in the measurements above.
    ['stage/lyrics/LyricBox.tsx'],
    ['game/hud/GameplayHud.tsx'],
    ['game/hud/MicStatusPill.tsx'],
    ['game/lane/LanePanel.tsx'],
    ['stage/SongInfoCard.tsx'],
  ])('keeps the singer-view surface %s at or under the cap, and never allowlists it', (file) => {
    expect(OVER_BUDGET_ALLOWLIST.has(file)).toBe(false)
    for (const use of ALL_USES.filter((u) => u.file === file)) {
      expect(use.radiusPx).toBeLessThanOrEqual(MAX_BACKDROP_BLUR_PX)
    }
  })

  it('caps the shared glass tokens themselves, so every token-driven surface inherits the budget', () => {
    expect(tokens.blur.max).toBeLessThanOrEqual(MAX_BACKDROP_BLUR_PX)
    expect(tokens.blur.min).toBeLessThanOrEqual(tokens.blur.max)
  })

  // The allowlist is a debt register. A test that only checks "<= cap" would
  // pass just as happily with everything on it, so the size is pinned too:
  // shrinking it is a passing change that must be accompanied by editing this
  // number down, and growing it cannot happen quietly.
  it('is empty -- every surface in the app is now inside the budget', () => {
    expect(OVER_BUDGET_ALLOWLIST.size).toBe(0)
  })
})
