import { useQuizStore } from '../store/quiz-store'
import { rankMovement, movementMark } from '../rank-movement'

// Vue participant du classement intermédiaire (mobile) : sa position perso.
export function LeaderboardPage() {
  const myId = useQuizStore((s) => s.myId)
  const leaderboard = useQuizStore((s) => s.leaderboard)
  const prevRanks = useQuizStore((s) => s.prevRanks)

  const me = leaderboard.find((s) => s.participantId === myId)
  if (!me) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Classement…
      </div>
    )
  }

  const mv = movementMark(rankMovement(prevRanks, me.participantId, me.rank))

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 gap-6 text-center">
      <p className="text-gray-400 uppercase tracking-wider text-sm">Classement</p>

      <div className="flex items-center gap-3">
        <span className="text-7xl font-black tabular-nums">{me.rank}</span>
        <span className="text-2xl text-gray-400">
          {me.rank === 1 ? 'ᵉʳ' : 'ᵉ'}
        </span>
        {mv.icon && <span className={`text-3xl ${mv.className}`}>{mv.icon}</span>}
      </div>

      <div className="bg-gray-900 rounded-2xl px-8 py-5">
        <p className="text-sm uppercase tracking-wider text-gray-400">Ton score</p>
        <p className="text-4xl font-black tabular-nums">{me.score}</p>
        {me.delta > 0 && (
          <p className="text-emerald-400 font-bold mt-1">+{me.delta} à cette question</p>
        )}
      </div>

      <p className="text-gray-500 text-sm">En attente de la prochaine question…</p>
    </div>
  )
}
