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
import {
  toParticipant,
  getParticipantList,
  isPseudoTaken,
  toPublicQuestion,
  getLeaderboard,
} from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot } from '../session-snapshot.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

// Bornes serveur — le payload vient d'un client non fiable (DevTools ouverts…)
const PSEUDO_MAX_LEN = 20

export function handleJoinSession(
  socket: QuizSocket,
  payload: { pin: string; pseudo: string; sessionToken: string | null },
  io: QuizServer,
): void {
  // Coercition + bornes : pin/pseudo peuvent être absents, d'un autre type, ou
  // démesurés (pseudo de 1 Mo rediffusé à toute la salle → casse la TV).
  const pin = String(payload?.pin ?? '').trim()
  const pseudo = String(payload?.pseudo ?? '').trim().slice(0, PSEUDO_MAX_LEN)
  const sessionToken =
    typeof payload?.sessionToken === 'string' ? payload.sessionToken : null

  if (!pseudo) {
    socket.emit(EVENTS.QUIZ_ERROR, { code: 'INVALID_PSEUDO', message: 'Choisis un pseudo.' })
    return
  }

  const session = getSessionByPin(pin)

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
    lastDelta: 0,
    correctTotal: 0,
  }

  session.participants.set(participant.id, participant)
  session.tokenIndex.set(newToken, participant.id)
  saveSessionSnapshot(session) // le token doit survivre à un restart serveur

  // Rejoindre la room Socket.io de la session
  void socket.join(session.id)

  // Confirmer au nouveau participant
  socket.emit(EVENTS.SESSION_JOINED, {
    sessionToken: newToken,
    sessionId: session.id,
    participant: toParticipant(participant),
    participants: getParticipantList(session),
    session: { status: session.status, pin: session.pin },
    mode: session.mode,
    teams: [...session.teams.values()],
    teamsLocked: session.teamsLocked,
    gameType: session.quiz?.gameType ?? 'classic',
  })

  // Retardataire en PLEINE question : lui rejouer la question en cours avec le
  // temps déjà écoulé (sans ça il attendait dans le lobby et voyait « Raté ❌ »
  // à la révélation d'une question qu'il n'avait jamais vue).
  const quiz = session.quiz
  const openQuestion =
    session.questionStartedAt !== null ? quiz?.questions[session.currentQuestionIndex] : undefined
  if (session.questionStartedAt !== null && quiz && openQuestion) {
    socket.emit(EVENTS.QUESTION_STARTED, {
      question: toPublicQuestion(
        openQuestion,
        session.currentQuestionIndex,
        quiz.questions.length,
        session.currentShuffled ?? undefined,
      ),
      startedAt: session.questionStartedAt,
      timeElapsed: (Date.now() - session.questionStartedAt) / 1000,
    })
  }

  // Retardataire en mode BUZZER : lui envoyer la question en cours + l'état buzzer
  // (owner_oral / steal / locked) → son téléphone affiche le bon écran/buzzer au
  // lieu de rester en « prépare-toi ». (En 'revealed'/idle, rien à rejouer.)
  if (
    quiz?.gameType === 'buzzer' &&
    session.buzz &&
    session.buzz.phase !== 'idle' &&
    session.buzz.phase !== 'revealed'
  ) {
    const bq = quiz.questions[session.currentQuestionIndex]
    if (bq) {
      socket.emit(EVENTS.BUZZ_QUESTION_STARTED, {
        question: toPublicQuestion(bq, session.currentQuestionIndex, quiz.questions.length),
        buzz: session.buzz,
      })
    }
  }

  // Notifier les autres
  socket.to(session.id).emit(EVENTS.PARTICIPANT_JOINED, {
    participant: toParticipant(participant),
  })
  logEvent('participant_joined', {
    sessionId: session.id,
    participantId: participant.id,
    pseudo: participant.pseudo,
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

  // Restaurer l'état de la question en cours (S7) : si une question est ouverte,
  // on renvoie son énoncé public + le temps déjà écoulé + si le participant a
  // déjà répondu → le client reprend exactement là où il en était.
  const quiz = session.quiz
  const openQuestion =
    session.questionStartedAt !== null ? quiz?.questions[session.currentQuestionIndex] : undefined
  const currentQuestion =
    session.questionStartedAt !== null && quiz && openQuestion
      ? toPublicQuestion(
          openQuestion,
          session.currentQuestionIndex,
          quiz.questions.length,
          session.currentShuffled ?? undefined,
        )
      : null
  const timeElapsed = session.questionStartedAt
    ? (Date.now() - session.questionStartedAt) / 1000
    : 0
  const scores = getLeaderboard(session)
  const myRank = scores.find((s) => s.participantId === participant.id)?.rank ?? 1

  // Résultat individuel de la dernière question fermée : rejoué au participant
  // qui reconnecte ENTRE deux questions (sinon il resterait figé sur une
  // question périmée — voire raterait le podium si c'était la dernière).
  const lastResult =
    currentQuestion === null && session.lastCorrectAnswers !== null
      ? {
          correctAnswers: session.lastCorrectAnswers,
          myAnswer: session.answers.get(participant.id)?.value ?? null,
          myCorrect: session.lastQuestionResults?.get(participant.id)?.correct ?? false,
          myDelta: session.lastQuestionResults?.get(participant.id)?.gained ?? 0,
        }
      : null

  socket.emit(EVENTS.SESSION_RESTORED, {
    participant: toParticipant(participant),
    participants: getParticipantList(session),
    currentQuestion,
    timeElapsed,
    alreadyAnswered: session.answers.has(participant.id),
    myScore: participant.score,
    myRank,
    scores,
    lastResult,
    session: { status: session.status, pin: session.pin },
    mode: session.mode,
    teams: [...session.teams.values()],
    teamsLocked: session.teamsLocked,
    gameType: session.quiz?.gameType ?? 'classic',
    buzz: session.buzz,   // mode buzzer : état courant → le tél retrouve son buzzer ; classic → null
  })

  // Notifier les autres que ce participant est de retour
  socket.to(session.id).emit(EVENTS.PARTICIPANT_JOINED, {
    participant: toParticipant(participant),
  })
  logEvent('participant_rejoined', {
    sessionId: session.id,
    participantId: participant.id,
    duringQuestion: currentQuestion !== null,
  })
}
