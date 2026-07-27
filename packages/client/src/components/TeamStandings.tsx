import type { TeamScore } from '@lya-quiz/shared'

// Classement des équipes, réutilisé sur le téléphone (big=false) et la TV (big=true).
// La couleur d'équipe est appliquée en style inline (hex) → pas de classe Tailwind
// dynamique qui serait purgée.
export function TeamStandings({
  teams,
  highlightTeamId,
  big = false,
}: {
  teams: TeamScore[]
  highlightTeamId?: string | null
  big?: boolean
}) {
  if (teams.length === 0) {
    return <p className="text-gray-500 text-center">Aucune équipe.</p>
  }
  return (
    <ol className={big ? 'w-full max-w-3xl space-y-3' : 'w-full space-y-2'}>
      {teams.map((t) => {
        const mine = !!highlightTeamId && t.teamId === highlightTeamId
        return (
          <li
            key={t.teamId}
            className={`flex items-center gap-4 rounded-2xl bg-gray-900 ${
              big ? 'px-8 py-5 text-3xl' : 'px-4 py-3'
            } ${mine ? 'ring-2 ring-white' : ''}`}
          >
            <span
              className={`font-black text-center ${big ? 'w-12 text-4xl' : 'w-7'}`}
              style={{ color: t.color }}
            >
              {t.rank}
            </span>
            <span
              className={`rounded-full shrink-0 ${big ? 'w-6 h-6' : 'w-4 h-4'}`}
              style={{ backgroundColor: t.color }}
            />
            <span className="font-bold flex-1 truncate">{t.name}</span>
            {t.delta > 0 && (
              <span className={`text-emerald-400 ${big ? 'text-2xl' : 'text-sm'}`}>+{t.delta}</span>
            )}
            <span className="font-mono font-black tabular-nums">{t.score}</span>
          </li>
        )
      })}
    </ol>
  )
}
