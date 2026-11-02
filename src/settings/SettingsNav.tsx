import { motion, useReducedMotion } from 'framer-motion'
import { tokens } from '../design/tokens'
import { PRESS_CLASS } from '../design/motion'
import { useSfx } from '../audio/useSfx'
import { useT } from '../i18n'

export interface SettingsNavSection {
  id: string
  label: string
}

interface SettingsNavProps {
  sections: readonly SettingsNavSection[]
  activeId: string
  onSelect: (id: string) => void
}

const ACTIVE_ACCENT = tokens.accent.cyan

/**
 * The settings tab rail: a real tab list, always visible, with the active tab
 * marked. Every tab keeps its own tab stop (no roving tabindex) because the
 * sofa's spatial focus can only reach ordinary focusable elements.
 */
export function SettingsNav({ sections, activeId, onSelect }: SettingsNavProps) {
  const reduceMotion = useReducedMotion()
  const playSfx = useSfx((state) => state.play)
  const t = useT()

  return (
    <div
      role="tablist"
      aria-label={t('settings.nav.label')}
      aria-orientation="vertical"
      className="flex flex-col gap-1"
      data-testid="settings-nav"
    >
      {sections.map((section) => {
        const isActive = section.id === activeId
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            id={`${section.id}-tab`}
            aria-selected={isActive}
            aria-controls={section.id}
            data-testid={`settings-nav-${section.id}`}
            className={`relative flex items-center rounded-2xl px-4 py-2.5 text-left text-[15px] font-medium ${PRESS_CLASS} ${
              isActive ? '' : 'hover:bg-surface-hover'
            }`}
            onMouseEnter={() => playSfx('hover')}
            onClick={() => {
              playSfx('click')
              onSelect(section.id)
            }}
          >
            {isActive && (
              <motion.span
                aria-hidden
                layoutId={reduceMotion ? undefined : 'settings-nav-active'}
                className="absolute inset-0 rounded-2xl border border-line bg-surface-raised"
                transition={tokens.spring.hover}
              />
            )}
            {/* The active marker is a shape, not just a colour, so the state
                does not depend on colour perception alone. */}
            <span
              aria-hidden
              className="relative mr-3 h-4 w-[3px] shrink-0 rounded-full transition-opacity"
              style={{ background: ACTIVE_ACCENT, opacity: isActive ? 1 : 0 }}
            />
            <span className={`relative ${isActive ? 'text-ink-primary' : 'text-ink-secondary'}`}>{section.label}</span>
          </button>
        )
      })}
    </div>
  )
}
