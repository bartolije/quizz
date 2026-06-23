import { socket } from '../socket'
import { EVENTS } from '@lya-quiz/shared'
import { useQuizStore } from '../store/quiz-store'
import { useRemaining } from '../hooks/useRemaining'
import { choiceStyle } from '../mcq'

// Vue participant pendant une question (mobile).
// L'énoncé est sur la TV — le téléphone n'affiche QUE les boutons de réponse.
export function QuestionPage() {
  const question = useQuizStore((s) => s.currentQuestion)
  const startedAt = useQuizStore((s) => s.questionStartedAt)
  const hasAnswered = useQuizStore((s) => s.hasAnswered)
  const markAnswered = useQuizStore((s) => s.markAnswered)

  const remaining = useRemaining(startedAt, question?.timeLimit ?? 0)

  if (!question) return null

  function answer(choice: string) {
    if (hasAnswered) return
    socket.emit(EVENTS.SUBMIT_ANSWER, { answer: choice })
    markAnswered()
  }

  const choices = question.choices ?? []

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-4">
      <header className="flex items-center justify-between mb-4">
        <span className="text-gray-400 text-sm">
          Question {question.index + 1} / {question.total}
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {Math.ceil(remaining)}s
        </span>
      </header>

      {hasAnswered ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-6xl">✓</div>
          <p className="text-2xl font-bold">Réponse envoyée</p>
          <p className="text-gray-400">En attente des autres…</p>
        </div>
      ) : (
        <>
          <p className="text-center text-gray-400 mb-4">👀 Regarde l'écran pour la question</p>
          <div className="flex-1 grid grid-cols-1 gap-3">
            {choices.map((choice, i) => {
              const st = choiceStyle(i)
              return (
                <button
                  key={choice}
                  onClick={() => answer(choice)}
                  className={`${st.bg} rounded-2xl px-5 py-6 flex items-center gap-4 text-left active:scale-[0.98] transition-transform`}
                >
                  <span className="text-3xl flex-shrink-0">{st.shape}</span>
                  <span className="text-xl font-bold">{choice}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
