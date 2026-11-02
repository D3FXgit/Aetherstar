import { solidSurfaceClass, tokens } from '../design/tokens'

/**
 * Row metrics and the text ramp for every Settings panel, defined once so the
 * panels line up. A plain .ts module so the component files export components only.
 */

/** Shared row box: fixed minimum height + identical horizontal padding for every row in every panel. */
export const ROW_CLASS = 'flex w-full min-h-[3.5rem] items-center justify-between gap-6 px-6 py-3 text-left'

export const ROW_LABEL_CLASS = 'truncate text-[15px] font-medium text-ink-primary'

export const ROW_DESCRIPTION_CLASS = 'text-[13px] leading-snug text-ink-secondary'

/** Empty-state line inside a panel. Not a full row: it has no control, so a row's height would leave a hole. */
export const EMPTY_STATE_CLASS = 'px-6 pb-3 text-[13px] leading-snug text-ink-secondary'

/** Every in-row button is this size, so the trailing column never ragged-edges. */
export const ROW_BUTTON_CLASS = 'px-4 py-2 text-xs font-medium'

/** The pane heading above the group card. */
export const GROUP_TITLE_CLASS = 'px-2 text-[16px] font-semibold text-ink-secondary'

/** Panel (sub-section) heading inside a group card. */
export const PANEL_TITLE_CLASS = 'text-[15px] font-semibold text-ink-primary'

/** The group card: the solid menu surface, so it reads from across the room. */
export const GROUP_SURFACE_CLASS = `${solidSurfaceClass()} overflow-hidden rounded-[26px]`

/** Staggered entrance, matching HeroFrame's container/item idiom so scenes animate alike. */
export const GROUP_CONTAINER_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
}

export const GROUP_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: tokens.spring.panelEnter },
}
