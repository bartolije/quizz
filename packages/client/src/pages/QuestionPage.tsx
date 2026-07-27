import { useState } from 'react'
import { useQuizStore } from '../store/quiz-store'
import { submitAnswerReliably } from '../submit-answer'
import { useRemaining } from '../hooks/useRemaining'
import { choiceStyle } from '../mcq'
import { TimePressure } from '../components/TimePressure'
import { QuestionImage } from '../components/QuestionImage'
import { OrderingList } from '../components/OrderingList'

// Vue participant pendant une question (mobile). Le rendu dépend du type :
// - mcq      : boutons couleur (énoncé sur la TV)
// - free     : champ texte
// - closest  : champ numérique
// - ordering : liste à réordonner (↑/↓) puis valider
//
// IMPORTANT — état neuf par question : ce composant est monté avec
// key={question.index} (cf. ParticipantApp). Le useState lazy de `order`/`text`
// ne s'exécute qu'au montage ; sans remount à chaque question, le tri par ordre
// repartait avec les choix de la question précédente (bug "ordering pas fonctionnel").
//
// IMPORTANT — layout mobile : hauteur calée sur le viewport (100dvh), contenu au
// milieu scrollable (overflow-y-auto + min-h-0), bouton d'action TOUJOURS visible
// en bas (flex-shrink-0). Sans ça, sur un petit écran le bouton « Valider » passait
// sous la ligne de flottaison et il fallait scroller pour le trouver.
export function QuestionPage() {
  const question = useQuizStore((s) => s.currentQuestion)
  const startedAt = useQuizStore((s) => s.questionStartedAt)
  const hasAnswered = useQuizStore((s) => s.hasAnswered)
  const answerStatus = useQuizStore((s) => s.answerStatus)
  const pendingAnswer = useQuizStore((s) => s.pendingAnswer)
  const [text, setText] = useState('')
  const [order, setOrder] = useState<string[]>(() => [...(question?.choices ?? [])])

  const remaining = useRemaining(startedAt, question?.timeLimit ?? 0)
  const lowTime = remaining > 0 && remaining <= 5

  if (!question) return null

  function submit(answer: string | number | string[]) {
    if (hasAnswered || !question) return
    // Envoi fiable : ack serveur + retries (cf. submit-answer.ts). L'UI passe
    // en « envoi… » immédiatement, puis « envoyée ✓ » à l'ack seulement.
    void submitAnswerReliably(answer, question.index)
  }

  return (
    <div className="h-dvh bg-gray-950 text-white flex flex-col p-4">
      <TimePressure active={lowTime && !hasAnswered} />
      <header className="shrink-0 flex items-center justify-between mb-4">
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
          {answerStatus === 'sent' ? (
            <>
              <div className="text-6xl">✓</div>
              <p className="text-2xl font-bold">Réponse envoyée</p>
              <p className="text-gray-400">En attente des autres…</p>
            </>
          ) : answerStatus === 'late' ? (
            <>
              <div className="text-6xl">⏱</div>
              <p className="text-2xl font-bold">Trop tard…</p>
              <p className="text-gray-400">La question était déjà fermée.</p>
            </>
          ) : answerStatus === 'failed' ? (
            <>
              <div className="text-6xl">⚠️</div>
              <p className="text-2xl font-bold">Réponse non envoyée</p>
              <p className="text-gray-400">Problème de connexion.</p>
              <button
                type="button"
                onClick={() => pendingAnswer !== null && submitAnswerReliably(pendingAnswer, question.index)}
                className="mt-2 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-xl font-bold"
              >
                Réessayer
              </button>
            </>
          ) : (
            <>
              <div className="w-10 h-10 border-2 border-gray-600 border-t-indigo-500 rounded-full animate-spin" />
              <p className="text-2xl font-bold">Envoi de ta réponse…</p>
            </>
          )}
        </div>
      ) : question.type === 'mcq' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <p className="shrink-0 text-center text-gray-400 mb-4">
            👀 Regarde l'écran pour la question
          </p>
          <div className="flex-1 grid grid-cols-1 gap-3 overflow-y-auto min-h-0">
            {(question.choices ?? []).map((choice, i) => {
              const st = choiceStyle(i)
              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => submit(choice)}
                  className={`${st.bg} rounded-2xl px-5 py-6 flex items-center gap-4 text-left active:scale-[0.98] transition-transform`}
                >
                  <span className="text-3xl shrink-0">{st.shape}</span>
                  <span className="text-xl font-bold">{choice}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : question.type === 'ordering' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
            <p className="text-lg font-bold text-center px-2">{question.text}</p>
            <QuestionImage key={question.mediaUrl} url={question.mediaUrl} className="max-h-40 max-w-full" />
            <p className="text-center text-gray-500 text-sm mb-1">
              Glisse <span className="text-gray-300">⠿</span> ou utilise ↑/↓ pour remettre dans l'ordre :
            </p>
            <OrderingList order={order} onChange={setOrder} />
          </div>
          <button
            type="button"
            onClick={() => submit(order)}
            className="shrink-0 mt-3 w-full py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xl font-bold transition-colors"
          >
            Valider l'ordre
          </button>
        </div>
      ) : (
        // free / closest : énoncé affiché + champ de saisie
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center gap-5">
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
              className="w-full text-center text-2xl bg-gray-800 rounded-2xl px-6 py-5 border-2 border-gray-700 focus:border-indigo-500 outline-hidden"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => submit(question.type === 'closest' ? Number(text) : text.trim())}
            disabled={!text.trim() || (question.type === 'closest' && Number.isNaN(Number(text)))}
            className="shrink-0 mt-3 w-full py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-xl font-bold transition-colors"
          >
            Envoyer
          </button>
        </div>
      )}
    </div>
  )
}
