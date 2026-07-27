import { useNavigate } from 'react-router'
import { useQuizStore } from '../store/quiz-store'
import { TeamStandings } from '../components/TeamStandings'

// Vue participant en fin de quiz (podium soigné en S5 ; classement équipe en mode équipe).
export function EndedPage() {
  const navigate = useNavigate()
  const myId = useQuizStore((s) => s.myId)
  const myScore = useQuizStore((s) => s.myScore)
  const leaderboard = useQuizStore((s) => s.leaderboard)
  const mode = useQuizStore((s) => s.mode)
  const teamLeaderboard = useQuizStore((s) => s.teamLeaderboard)
  const myTeamId = useQuizStore((s) => s.myTeamId)
  const reset = useQuizStore((s) => s.reset)

  // Sortir du podium pour rejoindre une AUTRE partie : sans ça le téléphone
  // restait bloqué ici (le token en localStorage renvoyait toujours vers ce
  // podium). On purge le token + le store → retour au formulaire PIN/pseudo.
  function joinNewGame() {
    localStorage.removeItem('lya_quiz_token')
    reset()
    navigate('/join', { replace: true })
  }

  const newGameButton = (
    <button
      type="button"
      onClick={joinNewGame}
      className="mt-6 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-lg font-bold transition-colors"
    >
      Rejoindre une nouvelle partie →
    </button>
  )

  if (mode === 'team') {
    const myTeam = teamLeaderboard.find((t) => t.teamId === myTeamId)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-6 pt-10 text-center gap-4">
        <div className="text-6xl">🏁</div>
        <h1 className="text-3xl font-black">Quiz terminé !</h1>
        {myTeam && (
          <p className="text-xl text-gray-300">
            {myTeam.name} finit <span className="text-white font-bold">{myTeam.rank}ᵉ</span>
          </p>
        )}
        <div className="w-full max-w-sm mt-2">
          <TeamStandings teams={teamLeaderboard} highlightTeamId={myTeamId} />
        </div>
        {newGameButton}
      </div>
    )
  }

  const me = leaderboard.find((s) => s.participantId === myId)

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center gap-4">
      <div className="text-6xl">🏁</div>
      <h1 className="text-3xl font-black">Quiz terminé !</h1>
      {me && (
        <p className="text-xl text-gray-300">
          Tu finis <span className="text-white font-bold">{me.rank}ᵉ</span>
        </p>
      )}
      <div className="bg-gray-900 rounded-2xl px-8 py-5 mt-2">
        <p className="text-sm uppercase tracking-wider text-gray-400">Score final</p>
        <p className="text-5xl font-black tabular-nums">{myScore}</p>
      </div>
      {newGameButton}
    </div>
  )
}
