import { useState } from 'react'
import type { Participant, SessionMode, Team } from '@lya-quiz/shared'

const MAX_TEAMS = 6

// Panneau host affiché en phase "waiting" (écran de contrôle). Gère le toggle
// solo/équipe, la création/suppression d'équipes, le verrou, l'auto-répartition
// et l'attribution des joueurs (tap sur une pastille de couleur).
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
}) {
  const [name, setName] = useState('')
  const connected = participants.filter((p) => p.connected)
  const unassignedCount = mode === 'team' ? connected.filter((p) => !p.teamId).length : 0

  function add() {
    const n = name.trim()
    if (!n) return
    addTeam(n)
    setName('')
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
                <span className="font-medium">{p.pseudo}</span>
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

          {/* Équipes existantes */}
          {teams.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {teams.map((t) => {
                const n = connected.filter((p) => p.teamId === t.id).length
                return (
                  <span
                    key={t.id}
                    className="flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 text-sm font-bold text-white"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.name} · {n}
                    <button
                      type="button"
                      onClick={() => removeTeam(t.id)}
                      aria-label={`Supprimer ${t.name}`}
                      className="w-5 h-5 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-xs"
                    >
                      ✕
                    </button>
                  </span>
                )
              })}
            </div>
          )}

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
              disabled={teams.length === 0 || unassignedCount === 0}
              className="px-3 py-2 rounded-xl text-sm font-bold bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40"
            >
              ⚖️ Répartir auto{unassignedCount > 0 ? ` (${unassignedCount})` : ''}
            </button>
          </div>

          {/* Attribution des joueurs : tap une pastille pour (ré)assigner */}
          {connected.length === 0 ? (
            <p className="text-gray-500 flex-1 flex items-center justify-center">
              En attente de participants…
            </p>
          ) : (
            <ul className="space-y-2 overflow-y-auto flex-1 min-h-0">
              {connected.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800"
                >
                  <span className="font-medium flex-1 truncate">{p.pseudo}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {teams.map((t) => {
                      const active = p.teamId === t.id
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => assign(p.id, t.id)}
                          aria-label={`Assigner ${p.pseudo} à ${t.name}`}
                          title={t.name}
                          className={`w-7 h-7 rounded-full transition-transform ${
                            active ? 'ring-2 ring-white scale-110' : 'opacity-50 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: t.color }}
                        />
                      )
                    })}
                    {p.teamId && (
                      <button
                        type="button"
                        onClick={() => assign(p.id, null)}
                        aria-label={`Retirer ${p.pseudo} de son équipe`}
                        className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
