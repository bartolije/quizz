import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Liste réordonnable pour les questions de type 'ordering' (vue participant mobile).
//
// Deux moyens d'interaction, par robustesse (priorité du projet = stabilité) :
//   1. Glisser-déposer via la poignée ⠿ (dnd-kit : capteurs pointer/touch + clavier).
//   2. Boutons ↑/↓ en fallback (accessibilité + filet si le drag pose souci).
//
// La poignée seule porte les listeners de drag + `touch-none` (touch-action:none),
// pour que le drag ne soit pas confondu avec le scroll de la liste : on scrolle en
// touchant ailleurs sur la ligne, on réordonne en attrapant la poignée.
// `id` = la valeur de l'item (les items d'un ordering sont uniques).

function Row({
  id,
  index,
  total,
  onMove,
}: {
  id: string
  index: number
  total: number
  onMove: (i: number, dir: -1 | 1) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 bg-gray-800 rounded-xl px-2 py-3 ${
        isDragging ? 'relative z-10 ring-2 ring-indigo-400 shadow-xl opacity-90' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Glisser pour réordonner"
        className="w-10 h-11 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 text-2xl touch-none select-none cursor-grab active:cursor-grabbing active:bg-gray-700"
      >
        ⠿
      </button>
      <span className="w-5 flex-shrink-0 text-center text-gray-500 font-bold">{index + 1}</span>
      <span className="flex-1 font-medium">{id}</span>
      <button
        type="button"
        onClick={() => onMove(index, -1)}
        disabled={index === 0}
        aria-label="Monter"
        className="w-10 h-11 flex-shrink-0 rounded-lg bg-gray-700 active:bg-gray-600 disabled:opacity-30 text-xl"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(index, 1)}
        disabled={index === total - 1}
        aria-label="Descendre"
        className="w-10 h-11 flex-shrink-0 rounded-lg bg-gray-700 active:bg-gray-600 disabled:opacity-30 text-xl"
      >
        ↓
      </button>
    </div>
  )
}

export function OrderingList({
  order,
  onChange,
}: {
  order: string[]
  onChange: (next: string[]) => void
}) {
  const sensors = useSensors(
    // distance:6 → un simple tap (sur les boutons ↑/↓) ne déclenche pas un drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onChange(arrayMove(order, from, to))
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    onChange(arrayMove(order, i, j))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {order.map((item, i) => (
            <Row key={item} id={item} index={i} total={order.length} onMove={move} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
