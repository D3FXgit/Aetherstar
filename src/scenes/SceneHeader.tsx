import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { GlassButton } from '../design/primitives/GlassButton'
import { easing } from '../design/tokens'
import type { SceneName } from './sceneStore'
import { SCENE_HEADER_HEIGHT_CLASS, sceneShowsHeader } from './sceneChrome'
import { SCENE_BACK_BUTTON_STYLE, du } from './designUnits'
import { useT } from '../i18n'

/** A stroked chevron rather than an arrow glyph, so it sits on the label's optical centre at any size. */
function ChevronLeft() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 3.5 5.5 9l6 5.5" />
    </svg>
  )
}

/**
 * The app's single Back authority (`handleBack` in App.tsx), so a screen can
 * draw the control without knowing what Back means. It is phase-aware (it
 * raises the abandon dialog mid-song) and is what Escape, Backspace and
 * gamepad B run too.
 */
const BackAuthorityContext = createContext<(() => void) | null>(null)

export function BackAuthorityProvider({
  onBack,
  children,
}: {
  onBack: () => void
  children: ReactNode
}) {
  return <BackAuthorityContext.Provider value={onBack}>{children}</BackAuthorityContext.Provider>
}

/**
 * The Back authority, or a no-op outside the shell so a screen still renders
 * alone in a test or the Dev Lab. Only BackButton reads it.
 */
function useBackAuthority(): () => void {
  return useContext(BackAuthorityContext) ?? (() => {})
}

interface BackButtonProps {
  /** Extra classes for the screen's own header row -- spacing, never appearance. */
  className?: string
  /** Metrics for a screen that scales its layout in design units (keep a 44pt floor via `max()`). */
  style?: CSSProperties
}

/**
 * The Back control itself. A real `<button>` (so gamepad focus reaches it),
 * 56pt tall (the most-pressed control, read from a sofa), with no focus style
 * or clipping of its own so the app's outset focus ring draws in full.
 */
export function BackButton({ className, style }: BackButtonProps) {
  const t = useT()
  const onBack = useBackAuthority()

  return (
    <GlassButton
      type="button"
      sfx="back"
      onClick={onBack}
      data-testid="back-button"
      className={`flex h-14 shrink-0 items-center gap-2 text-base font-semibold ${className ?? ''}`.trim()}
      style={style}
    >
      <ChevronLeft />
      {t('scene.back')}
    </GlassButton>
  )
}

interface SceneTitleBarProps {
  /** The screen's name, as its own `<h1>`. This is the row Back leads. */
  title: string
  /** One line under the title -- what the screen is for. Optional. */
  subtitle?: ReactNode
  /** Controls belonging to this screen, pushed to the trailing end of the title row. */
  trailing?: ReactNode
  /** Spacing for the screen that composes it -- gutters and top inset, never appearance. */
  className?: string
  /** Merged over the row's own metrics; the screen owns where the row sits. */
  style?: CSSProperties
}

/**
 * A screen's own header row: Back leads on the screen's gutter, centred on
 * the title; an optional subtitle sits on a second row. Sized in design units
 * and never clipping, so the focus ring stays whole.
 */
export function SceneTitleBar({ title, subtitle, trailing, className, style }: SceneTitleBarProps) {
  return (
    <header
      data-testid="scene-title-bar"
      className={`flex w-full shrink-0 flex-col ${className ?? ''}`.trim()}
      style={{ gap: du(14), ...style }}
    >
      <div className="flex w-full flex-wrap items-center" style={{ gap: du(20) }}>
        <BackButton style={SCENE_BACK_BUTTON_STYLE} />
        <h1
          className="min-w-0 font-bold tracking-tight text-ink-primary"
          style={{ fontSize: `max(1.75rem, ${du(34)})`, lineHeight: 1.05 }}
        >
          {title}
        </h1>
        {trailing && (
          <div className="ml-auto flex min-w-0 items-center" style={{ gap: du(12) }}>
            {trailing}
          </div>
        )}
      </div>
      {subtitle && (
        <div
          className="max-w-[80ch] text-ink-secondary"
          style={{ fontSize: `max(0.875rem, ${du(16)})`, lineHeight: 1.4 }}
        >
          {subtitle}
        </div>
      )}
    </header>
  )
}

interface SceneHeaderProps {
  /** The scene currently on screen; decides whether the fallback bar is shown. */
  scene: SceneName
}

/**
 * The fallback bar: a fixed top-leading Back for scenes without a title row
 * of their own (the lab scenes). The bar is click-through; only the button
 * takes pointer events.
 */
export function SceneHeader({ scene }: SceneHeaderProps) {
  const reduceMotion = useReducedMotion()
  const visible = sceneShowsHeader(scene)

  return (
    <AnimatePresence>
      {visible && (
        <motion.header
          data-testid="scene-header"
          data-reduced-motion={String(Boolean(reduceMotion))}
          // Nothing here clips, so the outset focus ring stays whole.
          className={`pointer-events-none fixed inset-x-0 top-0 z-50 flex ${SCENE_HEADER_HEIGHT_CLASS} items-center px-6`}
          initial={reduceMotion ? false : { opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: easing.emphasized }}
        >
          <BackButton className="pointer-events-auto" />
        </motion.header>
      )}
    </AnimatePresence>
  )
}
