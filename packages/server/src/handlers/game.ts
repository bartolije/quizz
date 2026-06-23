import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS, calculateScore } from '@lya-quiz/shared'
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

  // Reset des deltas, puis scoring des réponses de la question
  for (const p of session.participants.values()) p.lastDelta = 0

  for (const [pid, ans] of session.answers) {
    const p = session.participants.get(pid)
    if (!p) continue
    const elapsed = (ans.submittedAt - startedAt) / 1000
    const correct =
      q.type === 'mcq' &&
      typeof ans.value === 'string' &&
      q.correctAnswers.includes(ans.value)
    const gained = correct ? calculateScore(q.timeLimit, elapsed) : 0
    p.lastDelta = gained
    p.score += gained
  }

  // Répartition des réponses par choix (pour le bar chart de la TV)
  const distribution = (q.choices ?? []).map((choice) => ({
    value: choice,
    count: [...session.answers.values()].filter((a) => a.value === choice).length,
  }))

  const scores = getLeaderboard(session)

  // question_ended est personnalisé (myAnswer/myScore/myDelta) → emit par socket
  for (const p of session.participants.values()) {
    if (!p.connected) continue
    const ans = session.answers.get(p.id)
    io.to(p.socketId).emit(EVENTS.QUESTION_ENDED, {
      correctAnswers: q.correctAnswers,
      scores,
      distribution,
      myAnswer: ans?.value ?? null,
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
    myScore: 0,
    myDelta: 0,
  })
}
