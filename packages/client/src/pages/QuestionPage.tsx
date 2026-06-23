import { useState } from 'react'
import { socket } from '../socket'
import { EVENTS } from '@lya-quiz/shared'
import { useQuizStore } from '../store/quiz-store'
import { useRemaining } from '../hooks/useRemaining'
import { choiceStyle } from '../mcq'
import { TimePressure } from '../components/TimePressure'
import { QuestionImage } from '../components/QuestionImage'

// Vue participant pendant une question (mobile). Le rendu dépend du type :
// - mcq      : boutons couleur (énoncé sur la TV)
// - free     : champ texte
// - closest  : champ numérique
// - ordering : liste à réordonner (↑/↓) puis valider
export function QuestionPage() {
  const question = useQuizStore((s) => s.currentQuestion)
  const startedAt = useQuizStore((s) => s.questionStartedAt)
  const hasAnswered = useQuizStore((s) => s.hasAnswered)
  const markAnswered = useQuizStore((s) => s.markAnswered)
  const [text, setText] = useState('')
  const [order, setOrder] = useState<string[]>(() => [...(question?.choices ?? [])])

  const remaining = useRemaining(startedAt, question?.timeLimit ?? 0)
  const lowTime = remaining > 0 && remaining <= 5

  if (!question) return null

  function submit(answer: string | number | string[]) {
    if (hasAnswered) return
    socket.emit(EVENTS.SUBMIT_ANSWER, { answer })
    markAnswered()
  }

  function move(i: number, dir: -1 | 1) {
    setOrder((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-4">
      <TimePressure active={lowTime && !hasAnswered} />
      <header className="flex items-center justify-between mb-4">
        <span className="text-gray-400 text-sm">
          Question {question.index + 1} / {question.total}
        </span>
        <span
          className={`tabular-nums font-bold ${
            lowTime ? 'text-3xl text-red-500 animate-pulse' : 'text-2xl'
          }`}
        >
          {Math.ceil(remaining)}s
        </span>
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
      ) : question.type === 'ordering' ? (
        <div className="flex-1 flex flex-col gap-3">
          <p className="text-lg font-bold text-center px-2">{question.text}</p>
          <QuestionImage key={question.mediaUrl} url={question.mediaUrl} className="max-h-40 max-w-full" />
          <p className="text-center text-gray-500 text-sm mb-1">Remets dans le bon ordre :</p>
          <div className="flex-1 space-y-2">
            {order.map((item, i) => (
              <div key={item} className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-3">
                <span className="w-6 text-center text-gray-500 font-bold">{i + 1}</span>
                <span className="flex-1 font-medium">{item}</span>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="w-10 h-10 rounded-lg bg-gray-700 disabled:opacity-30 text-xl"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  className="w-10 h-10 rounded-lg bg-gray-700 disabled:opacity-30 text-xl"
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => submit(order)}
            className="w-full py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-xl font-bold transition-colors"
          >
            Valider l'ordre
          </button>
        </div>
      ) : (
        // free / closest : énoncé affiché + champ de saisie
        <div className="flex-1 flex flex-col justify-center gap-5">
          <p className="text-xl font-bold text-center px-2">{question.text}</p>
          <QuestionImage key={question.mediaUrl} url={question.mediaUrl} className="max-h-48 max-w-full" />
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
