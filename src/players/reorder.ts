import { arrayMove } from '@dnd-kit/sortable'

/** Pure reorder math for DndContext's onDragEnd, tested on its own because jsdom cannot simulate the drag. */
export function reorderedIds(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from === -1 || to === -1) return ids
  return arrayMove(ids, from, to)
}
