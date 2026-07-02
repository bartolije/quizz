import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { getSessionByPin, createSession, getAllSessions, type SessionState } from '../state.js'
import {
  getParticipantList,
  toPublicQuestion,
  getLeaderboard,
  getTeamLeaderboard,
} from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot, deleteSessionSnapshot } from '../session-snapshot.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

export function handleHostJoin(
  socket: QuizSocket,
  payload: { pin: string },
): void {
  let session = getSessionByPin(payload.pin.trim())

  // Si aucune session avec ce PIN, en créer une nouvelle
  // (le host crée la session en arrivant sur /host/control)
  if (!session) {
    session = createSession()
    saveSessionSnapshot(session)
    // On ignore le PIN fourni et on utilise celui généré
    // Le host lira le PIN affiché sur son écran
  }

  session.hostSocketIds.add(socket.id)
  void socket.join(session.id)
  void socket.join(`host:${session.id}`)   // room host-only pour answer_received
  logEvent('host_joined', { sessionId: session.id, pin: session.pin })

  // Envoyer l'état courant au host
  socket.emit(EVENTS.SESSION_JOINED, {
    sessionToken: `host:${session.id}`,   // token factice pour le host
    sessionId: session.id,
    participant: { id: 'host', pseudo: 'Host', connected: true },
    participants: getParticipantList(session),
    session: { status: session.status, pin: session.pin },
    mode: session.mode,
    teams: [...session.teams.values()],
    teamsLocked: session.teamsLocked,
  })

  // Reprise host (S7) : si une question est ouverte (le host a rafraîchi en
  // pleine partie ou s'est ré-attaché après une coupure), la lui renvoyer avec le
  // temps déjà écoulé — le chrono affiché repart de la vraie valeur, pas du max.
  if (session.questionStartedAt !== null && session.quiz) {
    const q = session.quiz.questions[session.currentQuestionIndex]
    if (q) {
      socket.emit(EVENTS.QUESTION_STARTED, {
        question: toPublicQuestion(
          q,
          session.currentQuestionIndex,
          session.quiz.questions.length,
          session.currentShuffled ?? undefined,
        ),
        startedAt: session.questionStartedAt,
        timeElapsed: (Date.now() - session.questionStartedAt) / 1000,
      })
    }
  }
}

export function handleHostDisconnect(
  socketId: string,
  sessionId: string,
  sessions: Map<string, SessionState>,
): void {
  const session = sessions.get(sessionId)
  if (session) {
    session.hostSocketIds.delete(socketId)
  }
}

// Le host lance le quiz : on passe la session en 'running' et on diffuse le
// changement de statut à toute la room (les deux vues host se synchronisent).
// (les questions arrivent en S4 — ici on ne fait que changer le statut)
export function handleHostStartQuiz(socket: QuizSocket, io: QuizServer): void {
  for (const session of getAllSessions()) {
    if (session.hostSocketIds.has(socket.id)) {
      session.status = 'running'
      saveSessionSnapshot(session)
      io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: session.status })
      logEvent('quiz_started', { sessionId: session.id })
      return
    }
  }
}

// Le host termine le quiz manuellement (S7) : ferme toute question ouverte,
// passe en 'ended' et diffuse le classement final.
export function handleHostEndQuiz(socket: QuizSocket, io: QuizServer): void {
  const session = getAllSessions().find((s) => s.hostSocketIds.has(socket.id))
  if (!session) return

  if (session.questionTimer) {
    clearTimeout(session.questionTimer)
    session.questionTimer = null
  }
  session.questionStartedAt = null
  session.status = 'ended'
  deleteSessionSnapshot(session.id) // partie finie : plus rien à restaurer

  io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: 'ended' })
  io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
    scores: getLeaderboard(session),
    final: true,
    ...(session.mode === 'team' ? { teamScores: getTeamLeaderboard(session) } : {}),
  })
}
