import { t } from '../i18n'

/**
 * Reads who has been picked on the Player Selection screen, live, from the
 * attributes SelectablePlayerBadge publishes (data-selected, data-mic-number
 * and data-player-name; the translated aria-label "<name>, Mic <n>" is only a
 * fallback for badges that predate data-player-name). A stopgap until SessionAssign calls
 * `setAudienceAssignSelection` (./audienceBroadcast.ts) directly. Polls, since
 * the badges re-render in bursts under layout animations anyway.
 */

/** The contract this reader depends on, spelled once. */
const PICKED_BADGE_SELECTOR = '[data-testid="selectable-player-badge"][data-selected="true"][data-mic-number]'

/** How often the selection screen is re-read while it is on top. */
export const ASSIGN_MIRROR_POLL_MS = 100

export interface MirroredPick {
  name: string
  /** 1-based mic number, exactly as drawn on the Tag. */
  micNumber: number
}

/**
 * The badge's label is the translated `assign.badge.label` ("{name}, Mic {number}"
 * in English). Rebuilding that template around a sentinel name tells us what
 * surrounds the name in the active language, so it can be cut back out.
 */
const NAME_SENTINEL = '\u0001'

function nameFromLabel(label: string, micNumber: number): string {
  const template = t('assign.badge.label', { name: NAME_SENTINEL, number: micNumber })
  const at = template.indexOf(NAME_SENTINEL)
  // A translation that drops {name} (or a label that does not fit the
  // template) leaves nothing to cut out: the whole label would be "Mic 1", not
  // a name, so read no name at all rather than a wrong one.
  if (at < 0) return ''
  const prefix = template.slice(0, at)
  const suffix = template.slice(at + NAME_SENTINEL.length)
  if (label.length < prefix.length + suffix.length) return ''
  if (!label.startsWith(prefix) || !label.endsWith(suffix)) return ''
  return label.slice(prefix.length, label.length - suffix.length)
}

/** The singer's name: the untranslated attribute when published, else cut from the label. */
function nameFromBadge(element: Element, micNumber: number): string {
  const published = element.getAttribute('data-player-name')
  if (published !== null) return published
  return nameFromLabel(element.getAttribute('aria-label') ?? '', micNumber)
}

/** Every singer currently holding a mic on the selection screen, lowest mic first. */
export function readAssignSelection(root: ParentNode = document): MirroredPick[] {
  const picks: MirroredPick[] = []

  for (const element of Array.from(root.querySelectorAll(PICKED_BADGE_SELECTOR))) {
    const micNumber = Number(element.getAttribute('data-mic-number'))
    if (!Number.isInteger(micNumber) || micNumber <= 0) continue
    const name = nameFromBadge(element, micNumber).trim()
    if (name === '') continue
    picks.push({ name, micNumber })
  }

  // Pick order is mic order (src/multiplayer/slots.ts), and document order is
  // roster order -- which is not the same thing. The audience list has to read
  // Mic 1, Mic 2, Mic 3 down the screen.
  return picks.sort((a, b) => a.micNumber - b.micNumber)
}

/** True when two readings describe the same line-up -- used to avoid re-broadcasting an unchanged screen. */
export function sameSelection(a: MirroredPick[], b: MirroredPick[]): boolean {
  if (a.length !== b.length) return false
  return a.every((pick, index) => pick.name === b[index].name && pick.micNumber === b[index].micNumber)
}

/**
 * Poll the selection screen, calling `onChange` only when the line-up actually
 * changes. Returns the stop function.
 */
export function watchAssignSelection(
  onChange: (picks: MirroredPick[]) => void,
  intervalMs: number = ASSIGN_MIRROR_POLL_MS,
): () => void {
  let previous: MirroredPick[] = []

  const read = () => {
    const picks = readAssignSelection()
    if (sameSelection(picks, previous)) return
    previous = picks
    onChange(picks)
  }

  read()
  const timer = setInterval(read, intervalMs)
  return () => clearInterval(timer)
}
