import { useEffect, useState } from 'react'
import { DndContext, type DragEndEvent, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { GlassButton } from '../design/primitives/GlassButton'
import { SceneTitleBar } from '../scenes/SceneHeader'
import { designUnitRootStyle, du, useDesignScale } from '../scenes/designUnits'
import { PlayerBadge } from './PlayerBadge'
import { PlayerForm } from './PlayerForm'
import { usePlayersStore } from './store'
import { reorderedIds } from './reorder'
import { tokens, withAlpha } from '../design/tokens'
import { useT } from '../i18n'

const CARD_CONTAINER_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
}

const CARD_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: tokens.spring.panelEnter },
}

interface RosterCardProps {
  id: string
  name: string
  color: string
  avatarUrl: string
  /** One design unit in px, for the badge -- whose size is an inline pixel number, not a CSS length. */
  scale: number
  onEdit: (id: string) => void
}

function RosterCard({ id, name, color, avatarUrl, scale, onEdit }: RosterCardProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const deletePlayer = usePlayersStore((s) => s.delete)
  const reduceMotion = useReducedMotion()

  // The entrance motion lives on a wrapper, never on the sortable node itself:
  // @dnd-kit drives the card's own `transform` through inline style, and a
  // motion component on that same element would overwrite it mid-drag.
  return (
    <motion.div variants={reduceMotion ? undefined : CARD_ITEM_VARIANTS}>
      <GlassPanel
        ref={setNodeRef}
        {...attributes}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          border: `1px solid ${withAlpha(color, 0.5)}`,
          width: du(220),
          padding: du(32),
          gap: du(16),
        }}
        className="flex flex-col items-center"
      >
        {/* Drag handle scoped to the badge/name, not the whole card -- otherwise
            @dnd-kit's pointer listeners intercept clicks on the Delete/Edit buttons below. */}
        <div {...listeners} className="flex cursor-grab flex-col items-center" style={{ gap: du(16) }}>
          <PlayerBadge name={name} color={color} avatarUrl={avatarUrl} size={Math.round(130 * scale)} />
          <span className="font-semibold text-ink-primary" style={{ fontSize: `max(1rem, ${du(18)})` }}>
            {name}
          </span>
        </div>
        <div className="flex gap-2">
          <GlassButton type="button" aria-label={t('players.card.editLabel', { name })} onClick={() => onEdit(id)}>
            {t('players.card.edit')}
          </GlassButton>
          <GlassButton type="button" aria-label={t('players.card.deleteLabel', { name })} onClick={() => deletePlayer(id)}>
            {t('players.card.delete')}
          </GlassButton>
        </div>
      </GlassPanel>
    </motion.div>
  )
}

export function Roster() {
  const t = useT()
  const players = usePlayersStore((s) => s.players)
  const load = usePlayersStore((s) => s.load)
  const reorder = usePlayersStore((s) => s.reorder)
  const [isCreating, setIsCreating] = useState(false)
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null)
  const scale = useDesignScale()

  useEffect(() => {
    load()
  }, [load])

  function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id
    if (!overId || event.active.id === overId) return
    reorder(reorderedIds(players.map((p) => p.id), String(event.active.id), String(overId)))
  }

  const editingPlayer = players.find((p) => p.id === editingPlayerId) ?? null

  return (
    // The roster owns the viewport; its header row (Back, then the title) sits
    // on the same gutter as the cards below.
    <div
      className="flex min-h-full w-full flex-col"
      data-testid="roster-scene"
      style={{ ...designUnitRootStyle(), padding: `${du(52)} ${du(64)} ${du(48)}`, gap: du(40) }}
    >
      <SceneTitleBar title={t('players.title')} subtitle={t('players.subtitle')} />

      <div className="flex flex-1 flex-col items-start" style={{ gap: du(28) }}>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={players.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
            <motion.div
              className="flex flex-wrap"
              style={{ gap: du(32) }}
              variants={CARD_CONTAINER_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              {players.map((player) => (
                <RosterCard
                  key={player.id}
                  id={player.id}
                  name={player.name}
                  color={player.color}
                  avatarUrl={player.avatarUrl}
                  scale={scale}
                  onEdit={setEditingPlayerId}
                />
              ))}
            </motion.div>
          </SortableContext>
        </DndContext>

        {editingPlayer ? (
          <PlayerForm
            initialName={editingPlayer.name}
            initialColor={editingPlayer.color}
            onCancel={() => setEditingPlayerId(null)}
            onSubmit={async (input) => {
              await usePlayersStore.getState().update({ id: editingPlayer.id, ...input })
              setEditingPlayerId(null)
            }}
          />
        ) : isCreating ? (
          <PlayerForm
            onCancel={() => setIsCreating(false)}
            onSubmit={async (input) => {
              await usePlayersStore.getState().create(input)
              setIsCreating(false)
            }}
          />
        ) : (
          <GlassButton
            type="button"
            variant="primary"
            onClick={() => setIsCreating(true)}
            style={{ height: `max(3.5rem, ${du(56)})`, paddingInline: `max(1.5rem, ${du(28)})`, fontSize: `max(1rem, ${du(17)})` }}
          >
            {t('players.add')}
          </GlassButton>
        )}
      </div>
    </div>
  )
}
