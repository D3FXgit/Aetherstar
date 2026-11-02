// `assign` phase: pick who sings this song. Picking also hands out the mics
// set up in Settings, lowest number first, in the order singers are picked; a
// claim lasts one song.
import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { usePlayersStore } from '../players/store'
import { useSessionStore } from './sessionStore'
import { useScene } from '../scenes/useScene'
import { useSfx } from '../audio/useSfx'
import { SelectablePlayerBadge } from './SelectablePlayerBadge'
import { PlayerForm } from '../players/PlayerForm'
import { BackButton } from '../scenes/SceneHeader'
import { FOCUS_RING_EXTENT, MAX_SELECTED_SCALE, assignGridFor, columnsFor } from './assignLayout'
import { claimableMicNumbers, micNumberFor, toggleMicAssignment } from '../multiplayer/slots'
import { useMicSlotStore } from '../multiplayer/store'
import { setAudienceAssignSelection } from '../audience/audienceBroadcast'
import { tokens } from '../design/tokens'
import { useT, type TFunction } from '../i18n'
import { du } from '../scenes/designUnits'
import { SingerDifficultyChip } from './SingerDifficultyPicker'
import { SessionButton } from './SessionButton'
import { VERSUS_SINGER_COUNT, canStartWith, clampLineupForMode, maxSingersFor } from './singerLimits'
import { CARD_STYLE, TEXT, difficultyRowHeightFor, displayType, sessionScreenStyle } from './sessionTheme'

/**
 * Name the mics on offer without reciting eight numbers: a contiguous rig reads
 * as a range, a rig with a gap is listed so it never promises a missing mic.
 */
function micRunSentence(t: TFunction, claimable: number[]): string {
  if (claimable.length === 0) return t('assign.mics.none')
  if (claimable.length === 1) return t('assign.mics.single', { number: claimable[0] })
  const isContiguous = claimable.every((micNumber, index) => micNumber === claimable[0] + index)
  return isContiguous
    ? t('assign.mics.range', { first: claimable[0], last: claimable[claimable.length - 1] })
    : t('assign.mics.list', { list: claimable.join(', ') })
}

const CONTAINER_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
}

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: tokens.spring.panelEnter },
}

/** The badge size is solved from the viewport, which changes when the window moves to the TV. */
function useViewportSize() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return size
}

export function SessionAssign() {
  const t = useT()
  const players = usePlayersStore((state) => state.players)
  const assignPlayers = useSessionStore((state) => state.assignPlayers)
  const mode = useSessionStore((state) => state.mode)
  const isVersus = mode === 'battle'
  const { navigate } = useScene()
  const playSfx = useSfx((state) => state.play)
  // Order matters and *is* the mic assignment: index 0 holds mic 1.
  const [pickedIds, setSelectedIds] = useState<string[]>([])
  // Versus is a duel. Derived rather than trimmed in an effect, so a switch to
  // Versus with three already picked never renders a three-way line-up even
  // for a frame: the first two picks (mics 1 and 2) stay, the rest drop out.
  const selectedIds = useMemo(() => clampLineupForMode(pickedIds, mode), [pickedIds, mode])
  /** Whether the inline "Add player" form is open. */
  const [isCreating, setIsCreating] = useState(false)

  // The audience display shows the line-up while it forms, before anything is
  // committed to the session store; null on unmount hands back to its fallback.
  useEffect(() => {
    setAudienceAssignSelection(selectedIds)
    return () => setAudienceAssignSelection(null)
  }, [selectedIds])
  const slots = useMicSlotStore((state) => state.slots)
  const reduceMotion = useReducedMotion()
  const viewport = useViewportSize()

  // Song select never loads the roster, and which mics exist decides how many
  // singers can be claimed, so both load here.
  useEffect(() => {
    usePlayersStore.getState().load()
    useMicSlotStore.getState().load()
  }, [])

  // assignLayout budgets the badge, its caption and the title/footer chrome;
  // every row here also carries a difficulty chip, so its height comes off the
  // viewport first. Solved twice because the chip scales with the badge.
  const rows = Math.max(1, Math.ceil(Math.max(players.length, 1) / columnsFor(players.length)))
  const gridFor = (chipRowHeight: number) =>
    assignGridFor({
      playerCount: players.length,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height - rows * chipRowHeight,
    })
  const grid = gridFor(difficultyRowHeightFor(gridFor(difficultyRowHeightFor(0)).badgeSize))
  const chipRowHeight = difficultyRowHeightFor(grid.badgeSize)
  // The band below scrolls, so it clips: keep a picked-and-hovered badge's
  // growth and the couch focus outline clear of its edges.
  const edgeClearance = Math.ceil((grid.badgeSize * (MAX_SELECTED_SCALE - 1)) / 2) + FOCUS_RING_EXTENT + 2
  // Only mics with hardware behind them; all eight on a never-configured rig (slots.ts).
  const claimable = claimableMicNumbers(slots)
  const micsFull = selectedIds.length >= claimable.length
  // Solo/Duet: one per claimable mic. Versus: two, and no fewer to start.
  const maxSingers = maxSingersFor(mode, claimable.length)
  const lineupFull = selectedIds.length >= maxSingers
  const canStart = canStartWith(mode, selectedIds.length)
  const footerHint = (() => {
    if (!isVersus) return micsFull ? { id: 'session-assign-full', text: t('assign.full', { count: claimable.length }) } : null
    if (claimable.length < VERSUS_SINGER_COUNT) {
      return { id: 'session-assign-versus-mics', text: t('assign.versus.needsTwoMics') }
    }
    return lineupFull
      ? { id: 'session-assign-versus-full', text: t('assign.versus.full') }
      : { id: 'session-assign-versus-pick', text: t('assign.versus.pickTwo') }
  })()

  function toggle(playerId: string) {
    playSfx(selectedIds.includes(playerId) ? 'back' : 'click')
    setSelectedIds((prev) =>
      toggleMicAssignment(clampLineupForMode(prev, mode), playerId, claimable.slice(0, maxSingers)),
    )
  }

  return (
    <motion.div
      // Exactly one window tall, not `min-h-screen` or flex-1: the roster scrolls in the
      // middle band below, so the footer -- and Start with it -- can never be
      // pushed off the bottom or covered, whatever the window size or roster.
      className="flex w-full flex-none flex-col gap-6 overflow-hidden p-8"
      style={sessionScreenStyle({ height: '100vh' })}
      data-testid="session-assign"
      variants={CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
    >
      {/* Leading-aligned so Back shares the heading's row; the grid below stays centred. */}
      <motion.header
        variants={reduceMotion ? undefined : ITEM_VARIANTS}
        className="flex shrink-0 items-center gap-5"
      >
        <BackButton />
        <div className="flex flex-col" style={{ gap: du(6) }}>
          <h1 style={displayType(44)}>{t('assign.title')}</h1>
          {/* Said once, so the numbered badges are not a puzzle. */}
          <p style={{ fontSize: `max(0.875rem, ${du(18)})`, fontWeight: 600, color: TEXT.secondary }}>
            {micRunSentence(t, claimable)}
          </p>
        </div>
      </motion.header>

      {/* The scrolling band: centred while it fits, scrollable when an eight-
          strong roster meets a small window. A motion.div so the container's
          stagger still reaches the badges through it. */}
      <motion.div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="session-assign-body">
        <div className="m-auto flex flex-col items-center gap-6" style={{ padding: edgeClearance }}>
          {players.length === 0 ? (
            <motion.div variants={reduceMotion ? undefined : ITEM_VARIANTS}>
              <div
                className="flex max-w-md flex-col text-center"
                style={{ ...CARD_STYLE, padding: du(40), gap: du(16) }}
                data-testid="session-assign-empty"
              >
                <h2 style={displayType(30)}>{t('assign.empty.title')}</h2>
                <p style={{ fontSize: `max(0.875rem, ${du(18)})`, color: TEXT.secondary }}>
                  {t('assign.empty.description')}
                </p>
                <SessionButton tone="primary" type="button" className="self-center" onClick={() => navigate('players')}>
                  {t('assign.empty.action')}
                </SessionButton>
              </div>
            </motion.div>
          ) : (
            <>
              {/* One column track per badge, with a gutter assignLayout sizes for the
                  selected growth and focus outlines of both neighbours. Each cell
                  is the badge plus its difficulty band: DOM order is badge, then
                  its chip, so Tab and the pad go singer -> difficulty -> next. */}
              <div
                data-testid="session-assign-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${grid.columns}, ${grid.badgeSize}px)`,
                  gap: grid.gap,
                  justifyContent: 'center',
                  justifyItems: 'center',
                  alignItems: 'start',
                }}
              >
                {players.map((player) => {
                  const micNumber = micNumberFor(selectedIds, player.id, claimable)
                  return (
                    <motion.div
                      key={player.id}
                      variants={reduceMotion ? undefined : ITEM_VARIANTS}
                      className="flex flex-col items-center"
                      data-testid="session-assign-cell"
                    >
                      <SelectablePlayerBadge
                        name={player.name}
                        avatarUrl={player.avatarUrl}
                        micNumber={micNumber}
                        size={grid.badgeSize}
                        disabled={lineupFull && !selectedIds.includes(player.id)}
                        onClick={() => toggle(player.id)}
                      />
                      {/* Reserved whether picked or not, so picking never reflows the grid. */}
                      {micNumber !== null ? (
                        <SingerDifficultyChip
                          playerId={player.id}
                          name={player.name}
                          micNumber={micNumber}
                          badgeSize={grid.badgeSize}
                        />
                      ) : (
                        <span aria-hidden="true" style={{ height: chipRowHeight }} />
                      )}
                    </motion.div>
                  )
                })}
              </div>

              {/* Adding someone who just walked in without leaving the screen (and
                  losing every pick). The full roster form, so they get a real
                  profile; they appear unpicked, because who sings is still a choice. */}
              {isCreating && (
                <motion.div variants={reduceMotion ? undefined : ITEM_VARIANTS}>
                  <div style={{ ...CARD_STYLE, padding: du(32) }} data-testid="session-assign-create">
                    <PlayerForm
                      onCancel={() => setIsCreating(false)}
                      onSubmit={async (input) => {
                        await usePlayersStore.getState().create(input)
                        setIsCreating(false)
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </motion.div>

      {players.length > 0 && (
        // Never scrolls and never shrinks: whatever the band above does, Start
        // stays on screen and is the last stop going down.
        <motion.footer
          variants={reduceMotion ? undefined : ITEM_VARIANTS}
          className="flex shrink-0 flex-wrap items-center justify-between gap-4"
          data-testid="session-assign-footer"
        >
          <div className="flex items-center gap-4">
            {!isCreating && (
              <SessionButton type="button" data-testid="session-assign-add-player" onClick={() => setIsCreating(true)}>
                {t('assign.addPlayer')}
              </SessionButton>
            )}
          </div>
          <div className="ml-auto flex items-center gap-4">
            {footerHint && (
              <p
                role="status"
                data-testid={footerHint.id}
                style={{ fontSize: `max(0.8125rem, ${du(15)})`, color: TEXT.secondary }}
              >
                {footerHint.text}
              </p>
            )}
            <SessionButton
              tone="primary"
              type="button"
              sfx="confirm"
              data-testid="session-assign-start"
              disabled={!canStart}
              onClick={() => canStart && assignPlayers(selectedIds)}
            >
              {t('assign.start')}
            </SessionButton>
          </div>
        </motion.footer>
      )}
    </motion.div>
  )
}
