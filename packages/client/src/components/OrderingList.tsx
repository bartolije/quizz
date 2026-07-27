import { useLayoutEffect, useRef } from 'react'
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
  registerEl,
}: {
  id: string
  index: number
  total: number
  onMove: (i: number, dir: -1 | 1) => void
  registerEl: (id: string, el: HTMLDivElement | null) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        registerEl(id, el)
      }}
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
        className="w-10 h-11 shrink-0 flex items-center justify-center rounded-lg text-gray-400 text-2xl touch-none select-none cursor-grab active:cursor-grabbing active:bg-gray-700"
      >
        ⠿
      </button>
      <span className="w-5 shrink-0 text-center text-gray-500 font-bold">{index + 1}</span>
      <span className="flex-1 font-medium">{id}</span>
      <button
        type="button"
        onClick={() => onMove(index, -1)}
        disabled={index === 0}
        aria-label="Monter"
        className="w-10 h-11 shrink-0 rounded-lg bg-gray-700 active:bg-gray-600 disabled:opacity-30 text-xl"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(index, 1)}
        disabled={index === total - 1}
        aria-label="Descendre"
        className="w-10 h-11 shrink-0 rounded-lg bg-gray-700 active:bg-gray-600 disabled:opacity-30 text-xl"
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

  // ── Animation FLIP des réordonnancements ──────────────────────
  // Un déplacement via ↑/↓ re-rend la liste instantanément : sans animation, on
  // ne VOIT pas les deux lignes s'échanger. On mémorise la position (top) de
  // chaque ligne, et au render suivant on la fait glisser de son ancienne
  // position vers la nouvelle (Web Animations API, aucun re-render).
  // Pendant un drag, dnd-kit anime déjà → on saute le tour pour ne pas doubler.
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const prevTops = useRef(new Map<string, number>())
  const skipFlipRef = useRef(false)

  const registerEl = (id: string, el: HTMLDivElement | null): void => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }

  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    for (const [id, el] of rowEls.current) {
      const newTop = el.getBoundingClientRect().top
      const prevTop = prevTops.current.get(id)
      if (
        !skipFlipRef.current &&
        !reduceMotion &&
        prevTop !== undefined &&
        Math.abs(prevTop - newTop) > 1
      ) {
        el.animate(
          [{ transform: `translateY(${prevTop - newTop}px)` }, { transform: 'translateY(0)' }],
          { duration: 200, easing: 'ease-out' },
        )
      }
      prevTops.current.set(id, newTop)
    }
    skipFlipRef.current = false
  }, [order])

  function handleDragEnd(e: DragEndEvent) {
    skipFlipRef.current = true // dnd-kit a déjà animé le drag, pas de double glissement
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
            <Row key={item} id={item} index={i} total={order.length} onMove={move} registerEl={registerEl} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
