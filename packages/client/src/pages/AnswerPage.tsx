import { useQuizStore } from '../store/quiz-store'

// Vue participant entre deux questions : résultat perso.
export function AnswerPage() {
  const result = useQuizStore((s) => s.lastResult)
  const myScore = useQuizStore((s) => s.myScore)

  if (!result) return null

  const correct = result.correct

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center p-6 text-center text-white ${
        correct ? 'bg-emerald-700' : 'bg-rose-800'
      }`}
    >
      <div className="text-7xl mb-4">{correct ? '✅' : '❌'}</div>
      <p className="text-4xl font-black mb-2">{correct ? 'Correct !' : 'Raté'}</p>

      {correct ? (
        <p className="text-2xl font-bold mb-6">+{result.myDelta} pts</p>
      ) : (
        <p className="text-lg opacity-90 mb-6">
          Bonne réponse : {result.correctAnswers.join(' / ')}
        </p>
      )}

      <div className="bg-black/20 rounded-2xl px-6 py-4">
        <p className="text-sm uppercase tracking-wider opacity-80">Ton score</p>
        <p className="text-4xl font-black tabular-nums">{myScore}</p>
      </div>

      <p className="text-sm opacity-80 mt-8">En attente de la suite…</p>
    </div>
  )
}
