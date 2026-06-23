import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import {
  EVENTS,
  calculateScore,
  calculateClosestScore,
  isCorrectFreeAnswer,
} from '@lya-quiz/shared'
import { getAllSessions, type SessionState } from '../state.js'
import { getLeaderboard, toPublicQuestion } from '../session-helpers.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

// ─────────────────────────────────────────────────────────────
// Résolution de session à partir d'un socket
// ─────────────────────────────────────────────────────────────

function findSessionByHostSocket(socketId: string): SessionState | undefined {
  return getAllSessions().find((s) => s.hostSocketIds.has(socketId))
}

function findParticipantContext(
  socketId: string,
): { session: SessionState; participantId: string } | undefined {
  for (const session of getAllSessions()) {
    for (const p of session.participants.values()) {
      if (p.socketId === socketId) return { session, participantId: p.id }
    }
  }
  return undefined
}

function connectedParticipants(session: SessionState) {
  return [...session.participants.values()].filter((p) => p.connected)
}

// ─────────────────────────────────────────────────────────────
// HOST : lancer la question suivante (ou terminer le quiz)
// ─────────────────────────────────────────────────────────────

export function handleNextQuestion(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || !session.quiz) return
  if (session.questionStartedAt !== null) return // une question est déjà ouverte

  const questions = session.quiz.questions
  const nextIndex = session.currentQuestionIndex + 1

  // Plus de questions → fin du quiz
  if (nextIndex >= questions.length) {
    session.status = 'ended'
    io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: 'ended' })
    io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
      scores: getLeaderboard(session),
      final: true,
    })
    return
  }

  const q = questions[nextIndex]
  if (!q) return

  session.currentQuestionIndex = nextIndex
  session.answers.clear()
  session.questionStartedAt = Date.now()

  // Fermeture automatique à la fin du temps imparti
  session.questionTimer = setTimeout(() => {
    closeQuestion(session, io)
  }, q.timeLimit * 1000)

  io.to(session.id).emit(EVENTS.QUESTION_STARTED, {
    question: toPublicQuestion(q, nextIndex, questions.length),
    startedAt: session.questionStartedAt,
  })
}

// ─────────────────────────────────────────────────────────────
// PARTICIPANT : soumettre une réponse
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// HOST : afficher le classement intermédiaire (entre deux questions)
// ─────────────────────────────────────────────────────────────

export function handleShowLeaderboard(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
    scores: getLeaderboard(session),
    final: false,
  })
}

export function handleSubmitAnswer(
  socket: QuizSocket,
  payload: { answer: string | number },
  io: QuizServer,
): void {
  const ctx = findParticipantContext(socket.id)
  if (!ctx) return
  const { session, participantId } = ctx

  if (session.questionStartedAt === null) return // pas de question ouverte
  if (session.answers.has(participantId)) return // déjà répondu (la 1ʳᵉ réponse compte)

  session.answers.set(participantId, {
    value: payload.answer,
    submittedAt: Date.now(),
  })

  const participant = session.participants.get(participantId)
  const connected = connectedParticipants(session)

  // Compteur live pour le host
  io.to(`host:${session.id}`).emit(EVENTS.ANSWER_RECEIVED, {
    participantId,
    pseudo: participant?.pseudo ?? '',
    answeredCount: session.answers.size,
    totalCount: connected.length,
  })

  // Fin anticipée : tous les connectés ont répondu
  if (connected.length > 0 && session.answers.size >= connected.length) {
    closeQuestion(session, io)
  }
}

// ─────────────────────────────────────────────────────────────
// Fermeture d'une question : scoring + révélation
// ─────────────────────────────────────────────────────────────

export function closeQuestion(session: SessionState, io: QuizServer): void {
  if (session.questionStartedAt === null) return // déjà fermée
  const startedAt = session.questionStartedAt
  session.questionStartedAt = null

  if (session.questionTimer) {
    clearTimeout(session.questionTimer)
    session.questionTimer = null
  }

  const quiz = session.quiz
  const q = quiz?.questions[session.currentQuestionIndex]
  if (!quiz || !q) return

  // Reset des deltas
  for (const p of session.participants.values()) p.lastDelta = 0

  // Parse robuste d'un nombre (virgule décimale tolérée) pour le type 'closest'
  const toNum = (v: string | number): number | null => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim())
    return Number.isFinite(n) ? n : null
  }

  // 'closest' : pré-calcul de la valeur cible + écart max parmi les réponses
  // numériques (sert de référence au scoring dégressif).
  let correctNum = 0
  let maxDeviation = 0
  if (q.type === 'closest') {
    correctNum = Number(q.correctAnswers[0])
    for (const ans of session.answers.values()) {
      const n = toNum(ans.value)
      if (n !== null) maxDeviation = Math.max(maxDeviation, Math.abs(correctNum - n))
    }
  }

  // Scoring par type → { gained, correct } par participant
  const results = new Map<string, { gained: number; correct: boolean }>()
  for (const [pid, ans] of session.answers) {
    const p = session.participants.get(pid)
    if (!p) continue
    const elapsed = (ans.submittedAt - startedAt) / 1000
    let gained = 0
    let correct = false

    if (q.type === 'mcq') {
      correct = typeof ans.value === 'string' && q.correctAnswers.includes(ans.value)
      gained = correct ? calculateScore(q.timeLimit, elapsed) : 0
    } else if (q.type === 'free') {
      correct = isCorrectFreeAnswer(String(ans.value), q.correctAnswers)
      gained = correct ? calculateScore(q.timeLimit, elapsed) : 0
    } else {
      // closest : tout le monde marque selon la distance (pas de bonus vitesse)
      const n = toNum(ans.value)
      gained = n === null ? 0 : calculateClosestScore(correctNum, n, maxDeviation)
    }

    p.lastDelta = gained
    p.score += gained
    results.set(pid, { gained, correct })
  }

  // Répartition par choix (bar chart TV) — pertinent uniquement pour le MCQ
  const distribution =
    q.type === 'mcq'
      ? (q.choices ?? []).map((choice) => ({
          value: choice,
          count: [...session.answers.values()].filter((a) => a.value === choice).length,
        }))
      : []

  const scores = getLeaderboard(session)

  // question_ended est personnalisé (myAnswer/myCorrect/myScore/myDelta) → emit par socket
  for (const p of session.participants.values()) {
    if (!p.connected) continue
    const ans = session.answers.get(p.id)
    io.to(p.socketId).emit(EVENTS.QUESTION_ENDED, {
      correctAnswers: q.correctAnswers,
      scores,
      distribution,
      myAnswer: ans?.value ?? null,
      myCorrect: results.get(p.id)?.correct ?? false,
      myScore: p.score,
      myDelta: p.lastDelta,
    })
  }

  // Vue host (pas de "my")
  io.to(`host:${session.id}`).emit(EVENTS.QUESTION_ENDED, {
    correctAnswers: q.correctAnswers,
    scores,
    distribution,
    myAnswer: null,
    myCorrect: false,
    myScore: 0,
    myDelta: 0,
  })
}
