import { useQuizStore } from '../store/quiz-store'

// Vue participant en fin de quiz (podium soigné en S5).
export function EndedPage() {
  const myId = useQuizStore((s) => s.myId)
  const myScore = useQuizStore((s) => s.myScore)
  const leaderboard = useQuizStore((s) => s.leaderboard)

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
    </div>
  )
}
