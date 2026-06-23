import { useState } from 'react'
import { socket } from '../socket'
import { EVENTS } from '@lya-quiz/shared'
import { useQuizStore } from '../store/quiz-store'
import { useRemaining } from '../hooks/useRemaining'
import { choiceStyle } from '../mcq'

// Vue participant pendant une question (mobile). Le rendu dépend du type :
// - mcq    : boutons couleur (énoncé sur la TV)
// - free   : champ texte
// - closest: champ numérique
export function QuestionPage() {
  const question = useQuizStore((s) => s.currentQuestion)
  const startedAt = useQuizStore((s) => s.questionStartedAt)
  const hasAnswered = useQuizStore((s) => s.hasAnswered)
  const markAnswered = useQuizStore((s) => s.markAnswered)
  const [text, setText] = useState('')

  const remaining = useRemaining(startedAt, question?.timeLimit ?? 0)

  if (!question) return null

  function submit(answer: string | number) {
    if (hasAnswered) return
    socket.emit(EVENTS.SUBMIT_ANSWER, { answer })
    markAnswered()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-4">
      <header className="flex items-center justify-between mb-4">
        <span className="text-gray-400 text-sm">
          Question {question.index + 1} / {question.total}
        </span>
        <span className="text-2xl font-bold tabular-nums">{Math.ceil(remaining)}s</span>
      </header>

      {hasAnswered ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-6xl">✓</div>
          <p className="text-2xl font-bold">Réponse envoyée</p>
          <p className="text-gray-400">En attente des autres…</p>
        </div>
      ) : question.type === 'mcq' ? (
        <>
          <p className="text-center text-gray-400 mb-4">👀 Regarde l'écran pour la question</p>
          <div className="flex-1 grid grid-cols-1 gap-3">
            {(question.choices ?? []).map((choice, i) => {
              const st = choiceStyle(i)
              return (
                <button
                  key={choice}
                  onClick={() => submit(choice)}
                  className={`${st.bg} rounded-2xl px-5 py-6 flex items-center gap-4 text-left active:scale-[0.98] transition-transform`}
                >
                  <span className="text-3xl flex-shrink-0">{st.shape}</span>
                  <span className="text-xl font-bold">{choice}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        // free / closest : énoncé affiché + champ de saisie
        <div className="flex-1 flex flex-col justify-center gap-5">
          <p className="text-xl font-bold text-center px-2">{question.text}</p>
          <input
            type={question.type === 'closest' ? 'number' : 'text'}
            inputMode={question.type === 'closest' ? 'numeric' : 'text'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                submit(question.type === 'closest' ? Number(text) : text.trim())
              }
            }}
            placeholder={question.type === 'closest' ? 'Ton nombre' : 'Ta réponse'}
            className="w-full text-center text-2xl bg-gray-800 rounded-2xl px-6 py-5 border-2 border-gray-700 focus:border-indigo-500 outline-none"
            autoFocus
          />
          <button
            onClick={() => submit(question.type === 'closest' ? Number(text) : text.trim())}
            disabled={!text.trim() || (question.type === 'closest' && Number.isNaN(Number(text)))}
            className="w-full py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-xl font-bold transition-colors"
          >
            Envoyer
          </button>
        </div>
      )}
    </div>
  )
}
