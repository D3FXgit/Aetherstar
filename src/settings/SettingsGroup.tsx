import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { GROUP_ITEM_VARIANTS, GROUP_SURFACE_CLASS, GROUP_TITLE_CLASS, PANEL_TITLE_CLASS } from './settingsStyles'

interface SettingsGroupProps {
  /** DOM id -- the tab panel this is, named by the matching `<SettingsNav>` tab. */
  id: string
  title: string
  children: ReactNode
}

/**
 * One pane of Settings: a single card whose panels are separated by
 * hairlines, so related settings read as one group. It is the `tabpanel` half
 * of the tab pattern; only the selected pane is mounted.
 */
export function SettingsGroup({ id, title, children }: SettingsGroupProps) {
  return (
    <motion.section
      id={id}
      role="tabpanel"
      aria-labelledby={`${id}-tab`}
      variants={GROUP_ITEM_VARIANTS}
      className="scroll-mt-6"
    >
      <h2 className={`${GROUP_TITLE_CLASS} mb-2.5`}>{title}</h2>
      <div className={GROUP_SURFACE_CLASS}>
        <div className="divide-y divide-line">{children}</div>
      </div>
    </motion.section>
  )
}

interface SettingsPanelProps {
  /**
   * Sub-heading for the block. Omitted for single-row panels, where a heading
   * above one row would just restate the row's own label.
   */
  title?: string
  testId: string
  /** Optional status shown on the panel's header line (right-aligned). */
  trailing?: ReactNode
  children: ReactNode
}

/** One panel inside a group: a block of rows, optionally titled, with no background of its own. */
export function SettingsPanel({ title, testId, trailing, children }: SettingsPanelProps) {
  return (
    <section data-testid={testId} className={title ? 'py-1' : undefined}>
      {title ? (
        <div className="flex items-center justify-between gap-4 px-6 pt-3 pb-1">
          <h3 className={PANEL_TITLE_CLASS}>{title}</h3>
          {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
        </div>
      ) : null}
      <div className="flex flex-col divide-y divide-line">{children}</div>
    </section>
  )
}
