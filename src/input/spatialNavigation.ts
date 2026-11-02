/**
 * Directional focus movement for the keyboard and gamepad hooks: focus goes to
 * the nearest focusable element in the pressed direction by on-screen geometry,
 * not DOM order, so 2D grids work with no per-screen wiring. DOM-only, no React.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

/** The subset of DOMRect this module needs — keeps the scoring function pure and testable. */
export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface FocusCandidate<T> {
  element: T
  rect: Bounds
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
].join(',')

const NATIVELY_ACTIVATABLE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'])

const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
])

/**
 * A candidate has to be *ahead* by at least this much to count as being in the
 * pressed direction — without it, two items whose centres differ by a rounding
 * error would both claim to be below each other.
 */
const MIN_STEP_PX = 1

/**
 * How much a sideways offset costs relative to a step in the pressed direction.
 * High enough that pressing Down from a grid cell reaches the cell underneath
 * rather than a nearer-by-a-few-pixels neighbour in the same row.
 */
const CROSS_AXIS_PENALTY = 3

/**
 * True for anything where the arrow keys and Space already mean something —
 * caret movement, scrubbing a range, opening a select. Directional navigation
 * must never take those over.
 */
export function isTextEntryElement(element: Element | null | undefined): boolean {
  if (!element) return false
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (element as HTMLInputElement).type.toLowerCase()
    return TEXT_ENTRY_INPUT_TYPES.has(type) || type === 'range'
  }
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  // jsdom doesn't implement `isContentEditable`, and neither does every host
  // for a detached node — the attribute is the durable signal.
  const editable = element.getAttribute('contenteditable')
  return editable !== null && editable !== 'false'
}

/** True when Enter/Space already activate the element on their own. */
export function isNativelyActivatable(element: Element | null | undefined): boolean {
  return Boolean(element) && NATIVELY_ACTIVATABLE.has(element!.tagName)
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false
  if (element.closest('[inert],[aria-hidden="true"]')) return false
  const view = element.ownerDocument.defaultView
  if (!view) return true
  const style = view.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
}

/**
 * The container directional navigation is confined to. A modal marks itself
 * with `data-focus-scope`; while one is open, Up/Down/Left/Right must not walk
 * out onto the screen behind it. The last one in document order wins, so a
 * dialog above a dialog still scopes correctly.
 */
export function focusScope(doc: Document = document): ParentNode {
  const scopes = doc.querySelectorAll('[data-focus-scope]')
  return scopes.length > 0 ? scopes[scopes.length - 1]! : doc
}

/** Every element the user can reach, in visual reading order (top row first, then left to right). */
export function getFocusableElements(root: ParentNode = document): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled')) return false
    if (element.getAttribute('tabindex') === '-1') return false
    if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'hidden') return false
    return isVisible(element)
  })

  return elements
    .map((element, index) => ({ element, index, rect: element.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left || a.index - b.index)
    .map((entry) => entry.element)
}

/** Distance between two 1-D spans, or 0 when they overlap at all. */
function spanGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (bStart < aEnd && bEnd > aStart) return 0
  return bStart >= aEnd ? bStart - aEnd : aStart - bEnd
}

function centre(rect: Bounds): { x: number; y: number } {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

/**
 * The scoring itself: of everything strictly ahead in `direction`, pick the one
 * with the lowest `distance ahead + sideways offset × penalty`. Sideways offset
 * is measured edge-to-edge and is free while the two elements overlap on the
 * cross axis, which is what makes a column of ragged-width rows feel like a
 * column.
 */
export function findInDirection<T>(from: Bounds, candidates: FocusCandidate<T>[], direction: Direction): T | null {
  const horizontal = direction === 'left' || direction === 'right'
  const fromCentre = centre(from)

  let best: T | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const candidateCentre = centre(candidate.rect)
    const dx = candidateCentre.x - fromCentre.x
    const dy = candidateCentre.y - fromCentre.y
    const ahead =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy
    if (ahead <= MIN_STEP_PX) continue

    const crossGap = horizontal
      ? spanGap(from.top, from.bottom, candidate.rect.top, candidate.rect.bottom)
      : spanGap(from.left, from.right, candidate.rect.left, candidate.rect.right)

    const score = ahead + crossGap * CROSS_AXIS_PENALTY
    if (score < bestScore) {
      bestScore = score
      best = candidate.element
    }
  }

  return best
}

function focusElement(element: HTMLElement): void {
  element.focus()
  // jsdom has no layout, so no scrollIntoView. `block/inline: 'nearest'` keeps
  // the newly focused card on screen without yanking the whole grid around.
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

/**
 * Move focus one step in `direction`. Returns whether anything moved, so the
 * caller knows whether to swallow the key (an unhandled Arrow should still be
 * free to scroll).
 */
export function moveFocus(direction: Direction, doc: Document = document): boolean {
  const candidates = getFocusableElements(focusScope(doc))
  if (candidates.length === 0) return false

  const active = doc.activeElement
  const currentIndex = active instanceof HTMLElement ? candidates.indexOf(active) : -1

  // Nothing focused yet (the usual state on entering a scene): the first press
  // in any direction lands on the first element rather than doing nothing.
  if (currentIndex === -1) {
    focusElement(candidates[0]!)
    return true
  }

  const current = candidates[currentIndex]!
  const next = findInDirection(
    current.getBoundingClientRect(),
    candidates
      .filter((_, index) => index !== currentIndex)
      .map((element) => ({ element, rect: element.getBoundingClientRect() })),
    direction,
  )

  if (!next) return false
  focusElement(next)
  return true
}

/**
 * Opt-in for a control that *uses* Left/Right while focused (a stepper, a
 * difficulty chip): mark it `data-dpad-horizontal="adjust"`. The keyboard
 * already reaches such a control as a real keydown; the pad does not -- it
 * moves focus directly -- so for the pad this hands the press to the control
 * as the same ArrowLeft/ArrowRight keydown, instead of moving focus.
 */
export const DPAD_HORIZONTAL_ATTRIBUTE = 'data-dpad-horizontal'

/**
 * Pad-side half of `DPAD_HORIZONTAL_ATTRIBUTE`. Returns true when the press
 * went to the focused control (the caller must then not move focus), false
 * when focus should move as usual -- any vertical press, or a focused element
 * that has not opted in.
 *
 * The keydown bubbles, so it reaches React's handlers and then the window-level
 * keyboard hook exactly as a real key would: a control that claims it
 * (`preventDefault`) keeps focus, one that does not lets the keyboard hook
 * navigate. Gamepad only -- calling this from the keyboard path would feed the
 * keyboard its own event back.
 */
export function adjustFocused(direction: Direction, doc: Document = document): boolean {
  if (direction !== 'left' && direction !== 'right') return false
  const active = doc.activeElement
  if (!(active instanceof HTMLElement) || active.getAttribute(DPAD_HORIZONTAL_ATTRIBUTE) !== 'adjust') return false
  const key = direction === 'left' ? 'ArrowLeft' : 'ArrowRight'
  const view = doc.defaultView ?? window
  active.dispatchEvent(new view.KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }))
  return true
}

/** Fire the focused element. Returns whether there was anything to fire. */
export function activateFocused(doc: Document = document): boolean {
  const active = doc.activeElement
  if (!(active instanceof HTMLElement) || active === doc.body) return false
  active.click()
  return true
}
