import { v4 as uuid } from 'uuid'
import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import {
  getSessionByPin,
  getAllSessions,
  type SessionState,
  type ParticipantState,
} from '../state.js'
import { toParticipant, getParticipantList, isPseudoTaken } from '../session-helpers.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

export function handleJoinSession(
  socket: QuizSocket,
  payload: { pin: string; pseudo: string; sessionToken: string | null },
  io: QuizServer,
): void {
  const { pin, pseudo, sessionToken } = payload

  const session = getSessionByPin(pin.trim())

  if (!session) {
    socket.emit(EVENTS.QUIZ_ERROR, { code: 'INVALID_PIN', message: 'Session introuvable.' })
    return
  }

  if (session.status === 'ended') {
    socket.emit(EVENTS.QUIZ_ERROR, { code: 'SESSION_ENDED', message: 'Cette session est terminée.' })
    return
  }

  // Si le client envoie un token existant → c'est un rejoin déguisé en join
  // (ex: refresh de page sans reconnexion Socket.io automatique)
  if (sessionToken) {
    const existingId = session.tokenIndex.get(sessionToken)
    const existing = existingId ? session.participants.get(existingId) : undefined
    if (existing) {
      handleRejoinWithParticipant(socket, session, existing, io)
      return
    }
  }

  // Vérifier pseudo libre
  if (isPseudoTaken(session, pseudo.trim())) {
    socket.emit(EVENTS.QUIZ_ERROR, { code: 'PSEUDO_TAKEN', message: 'Ce pseudo est déjà utilisé.' })
    return
  }

  // Créer le participant
  const newToken = uuid()
  const participant: ParticipantState = {
    id: uuid(),
    pseudo: pseudo.trim(),
    socketId: socket.id,
    sessionToken: newToken,
    connected: true,
    score: 0,
  }

  session.participants.set(participant.id, participant)
  session.tokenIndex.set(newToken, participant.id)

  // Rejoindre la room Socket.io de la session
  void socket.join(session.id)

  // Confirmer au nouveau participant
  socket.emit(EVENTS.SESSION_JOINED, {
    sessionToken: newToken,
    sessionId: session.id,
    participant: toParticipant(participant),
    participants: getParticipantList(session),
    session: { status: session.status, pin: session.pin },
  })

  // Notifier les autres
  socket.to(session.id).emit(EVENTS.PARTICIPANT_JOINED, {
    participant: toParticipant(participant),
  })
}

export function handleRejoinSession(
  socket: QuizSocket,
  payload: { sessionToken: string },
  io: QuizServer,
): void {
  // Chercher dans toutes les sessions (le client ne connaît que son token)
  for (const session of getAllSessions()) {
    const participantId = session.tokenIndex.get(payload.sessionToken)
    if (!participantId) continue

    const participant = session.participants.get(participantId)
    if (!participant) continue

    handleRejoinWithParticipant(socket, session, participant, io)
    return
  }

  socket.emit(EVENTS.QUIZ_ERROR, {
    code: 'INVALID_TOKEN',
    message: 'Session expirée ou introuvable.',
  })
}

function handleRejoinWithParticipant(
  socket: QuizSocket,
  session: SessionState,
  participant: ParticipantState,
  _io: QuizServer,
): void {
  // Mettre à jour le socketId (il a changé à la reconnexion)
  participant.socketId = socket.id
  participant.connected = true
  delete participant.disconnectedAt   // exactOptionalPropertyTypes : pas d'assignation à undefined

  void socket.join(session.id)

  // Calculer le temps écoulé sur la question en cours
  const timeElapsed = session.questionStartedAt
    ? (Date.now() - session.questionStartedAt) / 1000
    : 0

  // Restaurer l'état complet du participant
  socket.emit(EVENTS.SESSION_RESTORED, {
    participant: toParticipant(participant),
    participants: getParticipantList(session),
    currentQuestion: null,   // sera rempli en S3 quand on a les questions
    timeElapsed,
    myScore: participant.score,
    myRank: 1,   // sera calculé proprement en S5
    session: { status: session.status, pin: session.pin },
  })

  // Notifier les autres que ce participant est de retour
  socket.to(session.id).emit(EVENTS.PARTICIPANT_JOINED, {
    participant: toParticipant(participant),
  })
}
