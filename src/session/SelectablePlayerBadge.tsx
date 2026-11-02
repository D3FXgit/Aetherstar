// One profile on the Player Selection screen: an avatar, the mic it is holding
// for this song, and the player's name.
import { motion, useReducedMotion } from 'framer-motion'
import { BORDER_RADIUS_PERCENT, PlayerBadge } from '../players/PlayerBadge'
import { NEUTRAL_FALLBACK_COLOR } from '../players/colors'
import { micRimColor, springTransition } from '../design/tokens'
import { PRESS_SCALE, pressMotion } from '../design/motion'
import { useT } from '../i18n'

interface SelectablePlayerBadgeProps {
  name: string
  avatarUrl: string
  /**
   * The mic this player is holding for this song (1-based), or null if nobody
   * picked them. There is no `color` prop on purpose: profiles do not have
   * permanent colours, so the only colour on this card comes from the mic.
   */
  micNumber: number | null
  /** Edge of the square this card occupies in layout, unscaled. */
  size: number
  /** Every mic is taken and this player is not holding one. */
  disabled?: boolean
  onClick: () => void
}

/** How much larger a picked player's avatar sits, so the choice reads across the room. */
const SELECTED_SCALE = 1.06

/** Rim thickness scales with the badge so it reads the same at 1080p and 4K. */
function rimWidthFor(size: number): number {
  return Math.max(3, Math.round(size * 0.02))
}

export function SelectablePlayerBadge({
  name,
  avatarUrl,
  micNumber,
  size,
  disabled = false,
  onClick,
}: SelectablePlayerBadgeProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const selected = micNumber !== null
  const rimColor = selected ? micRimColor(micNumber - 1) : 'transparent'

  const restScale = selected ? SELECTED_SCALE : 1

  const rimWidth = rimWidthFor(size)
  const rimInset = rimWidth + 4
  const avatarSize = size - 2 * rimInset
  // Concentric corners: the rim's curve is the badge's curve pushed out by the
  // gap between them, so the band keeps the same width all the way round.
  const rimRadius = (avatarSize * BORDER_RADIUS_PERCENT) / 100 + rimInset
  // Centre-origin growth reaches down toward the caption as far as it reaches
  // up into the row gutter, so the text needs the same clearance the gutter has.
  const scaleClearance = Math.ceil(size * 0.05)
  const micFontSize = Math.max(11, Math.round(size * 0.085))
  const nameFontSize = Math.max(12, Math.round(size * 0.09))
  const micRowHeight = Math.round(micFontSize * 2.1)

  return (
    <motion.button
      type="button"
      data-testid="selectable-player-badge"
      // The gesture lives on the whole card so hovering the name counts, but
      // only the avatar actually grows -- see the rim's variants below. Text
      // that scales just goes soft. The empty `variants` is what makes this a
      // variant node, so the gesture label reaches the rim.
      variants={{}}
      whileHover={reduceMotion || disabled ? undefined : 'hover'}
      whileTap={reduceMotion || disabled ? undefined : 'tap'}
      data-selected={selected}
      {...(selected ? { 'data-mic-number': String(micNumber) } : {})}
      // The untranslated name, for the audience mirror (src/audience/assignSelectionMirror.ts):
      // the aria-label is translated and cannot be relied on to contain it.
      data-player-name={name}
      // A multi-select toggle, so the state is announced rather than only drawn.
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      aria-label={selected ? t('assign.badge.label', { name, number: micNumber }) : name}
      onClick={() => {
        if (disabled) return
        onClick()
      }}
      // A fixed footprint in both axes, identical selected or not: everything
      // that grows below grows by transform, inside the gutter that
      // assignLayout sizes for it. Nothing here reflows the grid.
      style={{
        width: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {/* Always rendered, so picking someone adds a mic badge without moving
          anything. The number is the identifier; the colour is reinforcement. */}
      <span
        data-testid="mic-badge-row"
        style={{ minHeight: micRowHeight, display: 'flex', alignItems: 'center' }}
      >
        {selected && (
          <motion.span
            data-testid="mic-number-badge"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.7, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={springTransition('tvOS', Boolean(reduceMotion))}
            style={{
              background: rimColor,
              color: '#08080b',
              borderRadius: 999,
              padding: `${Math.round(micFontSize * 0.28)}px ${Math.round(micFontSize * 0.8)}px`,
              fontSize: micFontSize,
              fontWeight: 800,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {t('assign.mic', { number: micNumber })}
          </motion.span>
        )}
      </span>

      {/* The rim is a border *inside* this card's own box, not an outset ring.
          An outset ring would sit in the same 0-6px band as the app's couch
          focus outline -- and mic 1's rim is literally the same cyan -- so the
          two would read as one another. Drawn inside, the focus outline still
          has clear air all the way around the card, and nothing clips it. */}
      <motion.span
        data-testid="badge-rim"
        // Border colour eases in CSS rather than through framer: the scale is
        // already a spring on this element, and an overshooting colour is not a
        // thing. `motion-reduce` turns the fade into a cut.
        className="transition-[border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        // Selected sits a little larger; hover and press are the app's shared
        // press feel on top of that. Never past MAX_SELECTED_SCALE: assignLayout
        // sizes the gutter for that much growth on both neighbours at once.
        variants={{
          rest: { scale: restScale },
          hover: { scale: restScale * PRESS_SCALE.hover },
          tap: { scale: restScale * PRESS_SCALE.tap },
        }}
        initial={false}
        animate="rest"
        transition={reduceMotion ? { duration: 0 } : pressMotion.transition}
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          borderStyle: 'solid',
          borderWidth: rimWidth,
          borderColor: rimColor,
          borderRadius: rimRadius,
          padding: rimInset - rimWidth,
        }}
      >
        {/* Unselected profiles are neutral: no profile owns a colour here. The
            selected one takes its mic's, which also lights PlayerBadge's glow
            so exactly one card in the grid is glowing. */}
        <PlayerBadge
          name={name}
          color={selected ? rimColor : NEUTRAL_FALLBACK_COLOR}
          avatarUrl={avatarUrl}
          size={avatarSize}
        />
      </motion.span>

      <span
        style={{
          marginTop: scaleClearance,
          maxWidth: size,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: nameFontSize,
          fontWeight: 600,
          lineHeight: 1.2,
          color: selected ? 'var(--ae-text-primary)' : 'var(--ae-text-secondary)',
        }}
      >
        {name}
      </span>
    </motion.button>
  )
}
