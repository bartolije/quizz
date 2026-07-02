import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { Participant, SessionMode, Team } from '@lya-quiz/shared'

const MAX_TEAMS = 6
const UNASSIGNED = '__unassigned__'

// Pastille joueur déplaçable (glisser vers une zone d'équipe).
function PlayerChip({ id, pseudo, onRemove }: { id: string; pseudo: string; onRemove?: () => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium cursor-grab active:cursor-grabbing touch-none select-none ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <span className="truncate">{pseudo}</span>
      {onRemove && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Retirer ${pseudo}`}
          className="w-5 h-5 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-xs flex-shrink-0"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// Zone d'accueil (équipe ou "sans équipe") : cible de drop.
function DropZone({
  id,
  title,
  color,
  count,
  onRemoveTeam,
  children,
}: {
  id: string
  title: string
  color?: string
  count: number
  onRemoveTeam?: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border-2 p-3 flex flex-col gap-2 min-h-[7rem] transition-colors ${
        isOver ? 'border-white bg-white/5' : 'border-gray-700'
      }`}
    >
      <div className="flex items-center gap-2">
        {color && (
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        )}
        <span className="font-bold flex-1 truncate" style={color ? { color } : undefined}>
          {title}
        </span>
        <span className="text-xs text-gray-400">{count}</span>
        {onRemoveTeam && (
          <button
            type="button"
            onClick={onRemoveTeam}
            aria-label={`Supprimer ${title}`}
            className="w-5 h-5 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-xs"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 flex-1 content-start">{children}</div>
    </div>
  )
}

// Panneau host (phase "waiting") : toggle solo/équipe, création d'équipes,
// verrou, auto-répartition, et attribution des joueurs par GLISSER-DÉPOSER
// (chaque joueur est une pastille à déposer dans une zone d'équipe).
export function HostTeamPanel({
  mode,
  teams,
  locked,
  participants,
  setMode,
  addTeam,
  removeTeam,
  lockTeams,
  assign,
  autobalance,
  onKick,
}: {
  mode: SessionMode
  teams: Team[]
  locked: boolean
  participants: Participant[]
  setMode: (mode: SessionMode) => void
  addTeam: (name: string) => void
  removeTeam: (teamId: string) => void
  lockTeams: (locked: boolean) => void
  assign: (participantId: string, teamId: string | null) => void
  autobalance: () => void
  onKick?: (participantId: string) => void
}) {
  const [name, setName] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const connected = participants.filter((p) => p.connected)
  const unassigned = connected.filter((p) => !p.teamId)
  const membersOf = (teamId: string) => connected.filter((p) => p.teamId === teamId)
  const pseudoOf = (id: string) => connected.find((p) => p.id === id)?.pseudo ?? ''

  function add() {
    const n = name.trim()
    if (!n) return
    addTeam(n)
    setName('')
  }

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = e
    if (!over) return
    const dest = String(over.id)
    assign(String(active.id), dest === UNASSIGNED ? null : dest)
  }

  return (
    <section className="bg-gray-900 rounded-3xl p-6 flex flex-col gap-4 overflow-y-auto">
      {/* Toggle mode */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{mode === 'team' ? 'Équipes' : 'Participants'}</h2>
        <div className="flex items-center gap-1 bg-gray-800 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setMode('solo')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              mode === 'solo' ? 'bg-indigo-600 text-white' : 'text-gray-400'
            }`}
          >
            Solo
          </button>
          <button
            type="button"
            onClick={() => setMode('team')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              mode === 'team' ? 'bg-indigo-600 text-white' : 'text-gray-400'
            }`}
          >
            Équipe
          </button>
        </div>
      </div>

      {mode === 'solo' ? (
        connected.length === 0 ? (
          <p className="text-gray-500 flex-1 flex items-center justify-center">
            En attente de participants…
          </p>
        ) : (
          <ul className="space-y-2 overflow-y-auto flex-1">
            {connected.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800">
                <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                <span className="font-medium flex-1">{p.pseudo}</span>
                {onKick && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Retirer ${p.pseudo} de la partie ?`)) onKick(p.id)
                    }}
                    className="px-2 py-1 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
                    title={`Retirer ${p.pseudo}`}
                    aria-label={`Retirer ${p.pseudo}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {/* Création d'équipe */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              maxLength={24}
              placeholder="Nom d'équipe"
              className="flex-1 bg-gray-800 rounded-xl px-4 py-2.5 border border-gray-700 focus:border-indigo-500 outline-none"
            />
            <button
              type="button"
              onClick={add}
              disabled={teams.length >= MAX_TEAMS || !name.trim()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-bold"
            >
              Ajouter
            </button>
          </div>

          {/* Contrôles */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => lockTeams(!locked)}
              className={`px-3 py-2 rounded-xl text-sm font-bold ${
                locked ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-300'
              }`}
            >
              {locked ? '🔒 Verrouillé' : '🔓 Déverrouillé'}
            </button>
            <button
              type="button"
              onClick={autobalance}
              disabled={teams.length === 0 || unassigned.length === 0}
              className="px-3 py-2 rounded-xl text-sm font-bold bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40"
            >
              ⚖️ Répartir auto{unassigned.length > 0 ? ` (${unassigned.length})` : ''}
            </button>
          </div>

          {teams.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">
              Crée au moins une équipe, puis glisse les joueurs dedans.
            </p>
          ) : (
            <>
              <p className="text-gray-500 text-xs">Glisse un joueur dans une équipe :</p>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={() => setDraggingId(null)}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto flex-1 min-h-0">
                  <DropZone id={UNASSIGNED} title="Sans équipe" count={unassigned.length}>
                    {unassigned.map((p) => (
                      <PlayerChip key={p.id} id={p.id} pseudo={p.pseudo} />
                    ))}
                  </DropZone>
                  {teams.map((t) => {
                    const members = membersOf(t.id)
                    return (
                      <DropZone
                        key={t.id}
                        id={t.id}
                        title={t.name}
                        color={t.color}
                        count={members.length}
                        onRemoveTeam={() => removeTeam(t.id)}
                      >
                        {members.map((p) => (
                          <PlayerChip
                            key={p.id}
                            id={p.id}
                            pseudo={p.pseudo}
                            onRemove={() => assign(p.id, null)}
                          />
                        ))}
                      </DropZone>
                    )
                  })}
                </div>
                <DragOverlay>
                  {draggingId ? (
                    <div className="rounded-lg bg-gray-600 px-3 py-2 text-sm font-medium shadow-xl">
                      {pseudoOf(draggingId)}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          )}
        </>
      )}
    </section>
  )
}
