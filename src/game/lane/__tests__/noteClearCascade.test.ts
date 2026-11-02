import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Two cascade bugs in the note-clear animation, pinned so they cannot come back.
 *
 * Both were invisible to every other kind of test: jsdom reported exactly what
 * the component intended, and in a real browser a golden note animated with
 * the *ordinary* keyframes, because
 *
 *     .ae-note[data-cleared]:not([data-cleared='awful'])   -> 3 selectors
 *     .ae-note[data-cleared-golden='true']                 -> 2 selectors
 *
 * and the more specific generic rule simply won. The same arithmetic then bit
 * the Reduce Motion override, which is far worse: the one person who asked for
 * less motion was the one person still getting a note that swelled and flashed.
 *
 * Specificity is not something a component test can observe, so it is asserted
 * here against the stylesheet itself -- the same tactic, for the same reason,
 * as design/__tests__/blurBudget.test.ts.
 */

/** The app's whole stylesheet: index.css plus the files it imports from src/styles. */
function readAppCss(): string {
  const root = join(process.cwd(), 'src')
  const stylesDir = join(root, 'styles')
  const parts = [readFileSync(join(root, 'index.css'), 'utf8')]
  if (existsSync(stylesDir)) {
    for (const file of readdirSync(stylesDir).sort()) {
      if (file.endsWith('.css') && !file.startsWith('._')) parts.push(readFileSync(join(stylesDir, file), 'utf8'))
    }
  }
  return parts.join('\n')
}

const CSS = readAppCss().replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  selector: string
  body: string
}

/** Every `selector { ... }` in the file, including the ones nested in an @media. */
function rules(css: string): Rule[] {
  const found: Rule[] = []
  let index = 0

  while (index < css.length) {
    const open = css.indexOf('{', index)
    if (open === -1) break
    const selector = css.slice(index, open).trim()

    let depth = 1
    let cursor = open + 1
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    const body = css.slice(open + 1, cursor - 1)

    if (selector.startsWith('@media')) found.push(...rules(body))
    else if (!selector.startsWith('@')) found.push({ selector, body })

    index = cursor
  }

  return found
}

const ALL = rules(CSS)

/**
 * Specificity as a single number, which is all these comparisons need: every
 * selector involved is built from classes, attribute selectors and `:not()`
 * around one attribute selector, and none of them uses an id or an element.
 */
function specificity(selector: string): number {
  const flat = selector.replace(/:not\(([^)]*)\)/g, '$1')
  const classes = flat.match(/\.[a-zA-Z][\w-]*/g) ?? []
  const attributes = flat.match(/\[[^\]]+\]/g) ?? []
  return classes.length + attributes.length
}

/** The single rule whose body declares this animation. */
function ruleDeclaring(animation: string): Rule {
  const matches = ALL.filter((rule) => new RegExp(`animation:\\s*${animation}\\b`).test(rule.body))
  expect(matches, `expected exactly one rule to declare "${animation}"`).toHaveLength(1)
  return matches[0]
}

describe('the note-clear cascade', () => {
  it('lets a golden note win over the ordinary clear it would otherwise inherit', () => {
    const generic = ruleDeclaring('aeNoteClear')
    const golden = ruleDeclaring('aeNoteClearGolden')

    // Both target the same element in the same state, so source order alone
    // decides only when specificity ties -- and golden is declared second.
    expect(specificity(golden.selector)).toBeGreaterThanOrEqual(specificity(generic.selector))
    expect(CSS.indexOf(golden.selector)).toBeGreaterThan(CSS.indexOf(generic.selector))
  })

  it('does the same for the golden flash', () => {
    const generic = ruleDeclaring('aeNoteFlash')
    const golden = ruleDeclaring('aeNoteFlashGolden')

    expect(specificity(golden.selector)).toBeGreaterThanOrEqual(specificity(generic.selector))
    expect(CSS.indexOf(golden.selector)).toBeGreaterThan(CSS.indexOf(generic.selector))
  })

  // The accessibility half, and the one that actually matters: an override that
  // loses the cascade is worse than no override, because it looks handled.
  it('switches every note animation off for Reduce Motion, whatever the note is', () => {
    const overrides = ALL.filter(
      (rule) => rule.selector.includes('.ae-note') && /animation:\s*none/.test(rule.body),
    )
    expect(overrides.length).toBeGreaterThan(0)

    const goldenSpecificity = specificity(ruleDeclaring('aeNoteClearGolden').selector)
    for (const rule of overrides) {
      // A missed note's `animation: none` is an ordinary style decision, not a
      // motion override, and does not need to outrank anything.
      if (rule.selector.includes("data-cleared='awful'")) continue
      const wins =
        /animation:\s*none\s*!important/.test(rule.body) || specificity(rule.selector) > goldenSpecificity
      expect(wins, `Reduce Motion rule cannot beat the golden rule: ${rule.selector}`).toBe(true)
    }
  })

  it('covers both ways a player can ask for less motion', () => {
    // The OS-level media query, and the app's own useReducedMotion() plumbed
    // through NoteLane's data-static -- framer-motion's hook is the only one of
    // the two that a test or a settings toggle can drive.
    expect(CSS).toContain('prefers-reduced-motion: reduce')
    expect(ALL.some((rule) => rule.selector.includes(".ae-lane[data-static='true']"))).toBe(true)
  })

  // A clear is allowed to cost a compositor layer for a third of a second. It
  // is not allowed to cost a layout pass, on a strip of forty pills per lane
  // across eight lanes, several times a second.
  //
  // The scan covers the pitch rule's keyframes too: it is the one element on
  // the screen that moves on *every* frame of the song, per singer, so anything
  // animating on it that is not compositor-only is the most expensive possible
  // version of this mistake.
  it('animates nothing but transform and opacity', () => {
    const animated = new Set<string>()
    for (const [, name, body] of CSS.matchAll(/@keyframes\s+(ae(?:Note|Hit|Pitch)\w*)\s*\{([\s\S]*?)\n\}/g)) {
      for (const [, property] of body.matchAll(/^\s{4}([a-z-]+):/gm)) animated.add(`${name}.${property}`)
    }

    expect(animated.size).toBeGreaterThan(0)
    for (const entry of animated) {
      const property = entry.split('.')[1]
      expect(['transform', 'opacity'], `${entry} is not compositor-only`).toContain(property)
    }
  })

  /**
   * The new gears in the burst -- the impact bloom, the golden starburst, the
   * inner shockwave, the spark streaks -- are all pseudo-elements of nodes the
   * pool already owns. That is the whole reason the burst could be reworked
   * without the node count moving (see hitFxPerformance.test.tsx's 448), and it
   * is the property that a future "just add a span for it" would break.
   */
  it('draws the burst\'s extra layers on pseudo-elements, never on new nodes', () => {
    for (const selector of [
      '.ae-hit-slot::before', // the impact bloom
      '.ae-hit-slot::after', // the golden starburst
      '.ae-hit-ring::before', // the inner shockwave
      '.ae-hit-particle::after', // each spark's streak
    ]) {
      expect(ALL.some((rule) => rule.selector.split(',').some((part) => part.trim() === selector)), selector).toBe(true)
    }
  })

  /**
   * Reduce Motion has to reach those pseudo-elements too, and it cannot do it
   * by hiding a child -- there is no child. `content: none` removes the box
   * outright. Without this the loudest part of a burst would be the one part
   * the person who asked for less motion still got.
   */
  it('removes the burst\'s pseudo-element layers outright for Reduce Motion', () => {
    const overrides = ALL.filter(
      (rule) => rule.selector.includes("[data-static='true']") && /content:\s*none/.test(rule.body),
    )
    expect(overrides.length).toBeGreaterThan(0)
    for (const rule of overrides) {
      expect(/content:\s*none\s*!important/.test(rule.body), rule.selector).toBe(true)
    }
  })
})

/**
 * Partial credit's half of the same stylesheet.
 *
 * The fill's end point is a custom property (`--ae-note-fill`) written per note
 * by NoteLane, and it has to be honoured in *both* places a cleared note is
 * drawn: the keyframe that sweeps the fill in, and the resting rule the
 * keyframe hands back to when it ends. Honouring only one of them is the
 * failure mode -- and it is invisible to a component test, because both write
 * the same attribute and jsdom computes neither.
 */
describe('the partial fill', () => {
  it('sweeps to the credit the note earned, not always to the end', () => {
    const fillKeyframe = CSS.match(/@keyframes\s+aeNoteFill\s*\{([\s\S]*?)\n\}/)
    expect(fillKeyframe, 'aeNoteFill keyframe').not.toBeNull()
    expect(fillKeyframe![1]).toMatch(/scaleX\(var\(--ae-note-fill/)
    // ...and still starts from nothing, so the sweep is a sweep.
    expect(fillKeyframe![1]).toMatch(/scaleX\(0\)/)
  })

  it('rests at that same credit once the sweep is over', () => {
    const resting = ALL.find((rule) => rule.selector === '.ae-note[data-cleared]::before')
    expect(resting, '.ae-note[data-cleared]::before').toBeDefined()
    expect(resting!.body).toMatch(/transform:\s*scaleX\(var\(--ae-note-fill/)
  })

  /**
   * A note cleared with no credit information -- a lab, a preview, the
   * declarative `hitTiers` prop, anything that predates partial credit -- must
   * render exactly as it always did. The default lives in the stylesheet so
   * that is true even for an element nobody wrote the property onto.
   */
  it('defaults to a whole note, so everything that predates it is unchanged', () => {
    const base = ALL.find((rule) => rule.selector === '.ae-note')
    expect(base, '.ae-note').toBeDefined()
    expect(base!.body).toMatch(/--ae-note-fill:\s*1\s*;/)
  })

  // Reduce Motion replaces the sweep with an arrival -- but the note still has
  // to arrive at the *right length*, or the one player who asked for less
  // motion is the one player who cannot see how much of the note they sang.
  it('survives Reduce Motion, because how much you sang is not decoration', () => {
    const staticRules = ALL.filter((rule) => rule.selector.includes('.ae-note') && /animation:\s*none/.test(rule.body))
    expect(staticRules.length).toBeGreaterThan(0)
    // Nothing in the Reduce Motion overrides may pin the fill back to a whole
    // note; they switch animations off and leave the resting rule in charge.
    for (const rule of staticRules) {
      expect(/scaleX\(1\)/.test(rule.body), rule.selector).toBe(false)
    }
  })
})
