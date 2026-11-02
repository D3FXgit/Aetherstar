/**
 * Stamps `data-nav-mode="directional"` on <html> while a gamepad or the arrow
 * keys drive focus, because a polled gamepad fires no input events and so never
 * triggers `:focus-visible`. The stylesheet draws the focus ring for `:focus` then.
 */

const ATTRIBUTE = 'data-nav-mode'
const DIRECTIONAL = 'directional'

export function markDirectionalInput(doc: Document = document): void {
  doc.documentElement.setAttribute(ATTRIBUTE, DIRECTIONAL)
}

export function clearDirectionalInput(doc: Document = document): void {
  doc.documentElement.removeAttribute(ATTRIBUTE)
}

export function isDirectionalInput(doc: Document = document): boolean {
  return doc.documentElement.getAttribute(ATTRIBUTE) === DIRECTIONAL
}
