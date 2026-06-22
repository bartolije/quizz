import type { Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { getSessionByPin, createSession, getAllSessions, type SessionState } from '../state.js'
import { getParticipantList } from '../session-helpers.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>

export function handleHostJoin(
  socket: QuizSocket,
  payload: { pin: string },
): void {
  let session = getSessionByPin(payload.pin.trim())

  // Si aucune session avec ce PIN, en créer une nouvelle
  // (le host crée la session en arrivant sur /host/control)
  if (!session) {
    session = createSession()
    // On ignore le PIN fourni et on utilise celui généré
    // Le host lira le PIN affiché sur son écran
  }

  session.hostSocketIds.add(socket.id)
  void socket.join(session.id)
  void socket.join(`host:${session.id}`)   // room host-only pour answer_received

  // Envoyer l'état courant au host
  socket.emit(EVENTS.SESSION_JOINED, {
    sessionToken: `host:${session.id}`,   // token factice pour le host
    sessionId: session.id,
    participant: { id: 'host', pseudo: 'Host', connected: true },
    participants: getParticipantList(session),
    session: { status: session.status, pin: session.pin },
  })
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

// Le host lance le quiz : on passe la session en 'running'.
// (les questions arrivent en S4 — ici on ne fait que changer le statut)
export function handleHostStartQuiz(socket: QuizSocket): void {
  for (const session of getAllSessions()) {
    if (session.hostSocketIds.has(socket.id)) {
      session.status = 'running'
      return
    }
  }
}
