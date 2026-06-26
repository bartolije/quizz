import type { Team } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'

// Sélecteur d'équipe (vue participant, lobby). Tap = rejoindre ; re-tap son équipe
// = la quitter. Désactivé si le host a verrouillé.
export function TeamPicker({
  teams,
  myTeamId,
  locked,
}: {
  teams: Team[]
  myTeamId: string | null
  locked: boolean
}) {
  function pick(teamId: string) {
    if (locked) return
    socket.emit(EVENTS.JOIN_TEAM, { teamId: teamId === myTeamId ? null : teamId })
  }

  return (
    <div className="w-full max-w-sm">
      <p className="text-gray-400 text-xs mb-3 uppercase tracking-wider">
        {locked ? '🔒 Équipes verrouillées par le host' : 'Choisis ton équipe'}
      </p>

      {teams.length === 0 ? (
        <p className="text-gray-500 text-sm text-center bg-gray-900 rounded-xl py-4">
          En attente que le host crée les équipes…
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {teams.map((t) => {
            const mine = t.id === myTeamId
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                disabled={locked}
                className={`flex items-center gap-3 rounded-2xl px-4 py-4 font-bold text-white transition-all disabled:opacity-60 ${
                  mine ? 'ring-2 ring-white' : ''
                }`}
                style={{ backgroundColor: mine ? t.color : 'rgba(255,255,255,0.06)' }}
              >
                <span
                  className="w-5 h-5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="flex-1 text-left">{t.name}</span>
                {mine && <span className="text-xl">✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {!locked && myTeamId && (
        <p className="text-gray-600 text-xs mt-2 text-center">
          Touche à nouveau ton équipe pour la quitter.
        </p>
      )}
    </div>
  )
}
