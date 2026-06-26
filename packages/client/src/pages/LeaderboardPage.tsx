import { useQuizStore } from '../store/quiz-store'
import { rankMovement, movementMark } from '../rank-movement'
import { TeamStandings } from '../components/TeamStandings'

// Vue participant du classement intermédiaire (mobile) : sa position perso (solo)
// ou le classement des équipes (mode équipe).
export function LeaderboardPage() {
  const myId = useQuizStore((s) => s.myId)
  const leaderboard = useQuizStore((s) => s.leaderboard)
  const prevRanks = useQuizStore((s) => s.prevRanks)
  const mode = useQuizStore((s) => s.mode)
  const teamLeaderboard = useQuizStore((s) => s.teamLeaderboard)
  const myTeamId = useQuizStore((s) => s.myTeamId)

  if (mode === 'team') {
    const myTeam = teamLeaderboard.find((t) => t.teamId === myTeamId)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-6 pt-10 gap-6">
        <p className="text-gray-400 uppercase tracking-wider text-sm">Classement des équipes</p>
        {myTeam && (
          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full" style={{ backgroundColor: myTeam.color }} />
              <span className="text-2xl font-black">{myTeam.name}</span>
            </div>
            <p className="text-6xl font-black tabular-nums mt-1">
              {myTeam.rank}
              <span className="text-xl text-gray-400">{myTeam.rank === 1 ? 'ᵉʳ' : 'ᵉ'}</span>
            </p>
            <p className="text-gray-300 mt-1">
              {myTeam.score} pts
              {myTeam.delta > 0 && <span className="text-emerald-400"> · +{myTeam.delta}</span>}
            </p>
          </div>
        )}
        <TeamStandings teams={teamLeaderboard} highlightTeamId={myTeamId} />
        <p className="text-gray-500 text-sm">En attente de la prochaine question…</p>
      </div>
    )
  }

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
