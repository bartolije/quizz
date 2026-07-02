import type { SubmitAnswerAck } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from './socket'
import { useQuizStore } from './store/quiz-store'

// Envoi FIABLE d'une réponse : ack serveur + retries.
// Le serveur déduplique par participant (la 1ʳᵉ réponse compte) et vérifie
// questionIndex → ré-émettre est toujours sûr, même après une coupure.
const ACK_TIMEOUT_MS = 2000
const MAX_TRIES = 5 // ~10 s au total : couvre une micro-coupure + reconnexion
const RETRY_PAUSE_MS = 600 // quand le serveur répond « pas encore rattaché » (rejoin en cours)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function submitAnswerReliably(
  answer: string | number | string[],
  questionIndex: number,
): Promise<void> {
  const store = useQuizStore.getState
  store().beginAnswer(answer)

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    // La partie a avancé pendant nos retries (question suivante, révélation…) :
    // inutile d'insister, et surtout ne pas écraser l'état de la nouvelle question.
    const current = store()
    if (current.currentQuestion?.index !== questionIndex || current.currentView !== 'question') return

    try {
      const res: SubmitAnswerAck = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(EVENTS.SUBMIT_ANSWER, { answer, questionIndex })

      if (res.ok) {
        // accepted | already_answered → la réponse est enregistrée côté serveur
        store().answerDelivered()
        return
      }
      if (res.status === 'question_closed') {
        store().answerLate()
        return
      }
      if (res.status === 'not_in_session') {
        // Le rejoin_session (émis automatiquement sur 'connect') n'a pas encore
        // réassocié ce socket au participant : petite pause puis on retente.
        await sleep(RETRY_PAUSE_MS)
        continue
      }
      // invalid_answer (ou statut inconnu) : re-émettre ne changera rien
      store().answerFailed()
      return
    } catch {
      // timeout ou socket fermé : Socket.io retente la connexion en fond, on ré-émet
    }
  }

  store().answerFailed()
}
