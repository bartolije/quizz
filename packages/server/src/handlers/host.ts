import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { getSessionByPin, getSessionById, getAllSessions, type SessionState } from '../state.js'
import {
  getParticipantList,
  toPublicQuestion,
  getLeaderboard,
  getTeamLeaderboard,
  getTeamsPayload,
} from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot, deleteSessionSnapshot } from '../session-snapshot.js'
import { buildThemes } from './buzzer.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

// État courant + rejeu de la question ouverte — commun au host (control) et à
// la TV (display). Le socket rejoint la room de session + la room host-only
// (compteur answer_received, copie neutre de question_ended).
function attachAndSendState(socket: QuizSocket, session: SessionState): void {
  void socket.join(session.id)
  void socket.join(`host:${session.id}`)

  socket.emit(EVENTS.SESSION_JOINED, {
    sessionToken: `host:${session.id}`,   // token factice (host/TV n'ont pas de token de reprise)
    sessionId: session.id,
    participant: { id: 'host', pseudo: 'Host', connected: true },
    participants: getParticipantList(session),
    session: { status: session.status, pin: session.pin },
    mode: session.mode,
    teams: [...session.teams.values()],
    teamsLocked: session.teamsLocked,
    gameType: session.quiz?.gameType ?? 'classic',
    ...(session.quiz ? { quizTitle: session.quiz.title } : {}),
  })

  // Reprise (S7) : si une question est ouverte (refresh ou ré-attachement en
  // pleine partie), la renvoyer avec le temps déjà écoulé — le chrono affiché
  // repart de la vraie valeur, pas du max.
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

  // Mode buzzer : ré-attacher l'état de la partie famille (host/TV qui reconnecte
  // ou refresh) → thèmes + attribution + progression, puis la question en cours.
  if (session.quiz?.gameType === 'buzzer') {
    socket.emit(EVENTS.BUZZ_THEMES, buildThemes(session))
    if (session.buzz && session.buzz.phase !== 'idle') {
      const q = session.quiz.questions[session.currentQuestionIndex]
      if (q) {
        socket.emit(EVENTS.BUZZ_QUESTION_STARTED, {
          question: toPublicQuestion(q, session.currentQuestionIndex, session.quiz.questions.length),
          buzz: session.buzz,
        })
      }
    }
  }
}

export function handleHostJoin(
  socket: QuizSocket,
  payload: { pin: string; hostKey: string },
): void {
  const session = getSessionByPin(String(payload?.pin ?? '').trim())

  // Plus de création implicite : un PIN inconnu (session perdue, faute de
  // frappe) est une ERREUR explicite — avant, ça créait en silence une nouvelle
  // session avec le plus vieux quiz de la base, et le host pouvait animer la
  // soirée sur le mauvais quiz sans s'en rendre compte.
  if (!session) {
    socket.emit(EVENTS.QUIZ_ERROR, {
      code: 'INVALID_PIN',
      message: 'Session introuvable. Crée une nouvelle session depuis /host/control.',
    })
    return
  }

  // Le PIN est PUBLIC (affiché en grand sur la TV) : seul le porteur du hostKey
  // (retourné par POST /api/sessions, stocké côté host) peut piloter la partie.
  if (payload?.hostKey !== session.hostKey) {
    socket.emit(EVENTS.QUIZ_ERROR, {
      code: 'INVALID_HOST_KEY',
      message: 'Clé host invalide pour cette session.',
    })
    logEvent('host_join_rejected', { sessionId: session.id, socketId: socket.id })
    return
  }

  session.hostSocketIds.add(socket.id)
  logEvent('host_joined', { sessionId: session.id, pin: session.pin })
  attachAndSendState(socket, session)
}

// TV / écran passif : lecture seule, capacité = connaître le sessionId (uuid
// non devinable). Jamais ajouté à hostSocketIds → les events host_* émis par
// ce socket sont ignorés par le serveur.
export function handleDisplayJoin(
  socket: QuizSocket,
  payload: { sessionId: string },
): void {
  const session = getSessionById(String(payload?.sessionId ?? ''))
  if (!session) {
    socket.emit(EVENTS.QUIZ_ERROR, {
      code: 'INVALID_PIN',
      message: 'Session introuvable ou terminée.',
    })
    return
  }
  logEvent('display_joined', { sessionId: session.id })
  attachAndSendState(socket, session)
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

// Éjecter un participant (troll, doublon de pseudo…). Retiré de la session
// (score compris), token invalidé (il ne peut pas re-rentrer par reconnexion
// automatique — il peut re-rejoindre par PIN + pseudo si c'était une erreur).
export function handleKickParticipant(
  socket: QuizSocket,
  payload: { participantId: string },
  io: QuizServer,
): void {
  const session = getAllSessions().find((s) => s.hostSocketIds.has(socket.id))
  if (!session) return
  const participant = session.participants.get(String(payload?.participantId ?? ''))
  if (!participant) return

  session.participants.delete(participant.id)
  session.tokenIndex.delete(participant.sessionToken)
  session.answers.delete(participant.id) // sa réponse à la question en cours ne compte plus
  // Mode buzzer : libérer les thèmes dont il était propriétaire (binding périmé)
  for (const [k, v] of session.ownerBindings) if (v === participant.id) session.ownerBindings.delete(k)

  // Prévenir l'éjecté (s'il est connecté) et le sortir de la room
  const target = io.sockets.sockets.get(participant.socketId)
  if (target) {
    target.emit(EVENTS.QUIZ_ERROR, {
      code: 'KICKED',
      message: "Tu as été retiré de la partie par l'animateur.",
    })
    void target.leave(session.id)
  }

  // participant_left (compat) + état complet (teams_updated remplace la liste
  // des participants côté clients → l'éjecté disparaît vraiment des écrans)
  io.to(session.id).emit(EVENTS.PARTICIPANT_LEFT, { participantId: participant.id })
  io.to(session.id).emit(EVENTS.TEAMS_UPDATED, getTeamsPayload(session))
  if (session.quiz?.gameType === 'buzzer') io.to(session.id).emit(EVENTS.BUZZ_THEMES, buildThemes(session))
  saveSessionSnapshot(session)
  logEvent('participant_kicked', {
    sessionId: session.id,
    participantId: participant.id,
    pseudo: participant.pseudo,
  })
}

// Mode buzzer : ajouter un joueur « sans téléphone » (participant fantôme géré
// par l'admin). Il peut posséder un thème et marquer des points (l'admin tape),
// mais n'a pas d'appareil → il ne buzze jamais.
export function handleAddManualParticipant(
  socket: QuizSocket,
  payload: { pseudo: string },
  io: QuizServer,
): void {
  const session = getAllSessions().find((s) => s.hostSocketIds.has(socket.id))
  if (!session) return
  const pseudo = String(payload?.pseudo ?? '').trim().slice(0, 40)
  if (!pseudo) return
  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  session.participants.set(id, {
    id,
    pseudo,
    socketId: '',
    sessionToken: token,
    connected: false,
    score: 0,
    lastDelta: 0,
    correctTotal: 0,
    manual: true,
    bonus: 0,
  })
  session.tokenIndex.set(token, id)
  io.to(session.id).emit(EVENTS.TEAMS_UPDATED, getTeamsPayload(session))
  if (session.quiz?.gameType === 'buzzer') io.to(session.id).emit(EVENTS.BUZZ_THEMES, buildThemes(session))
  saveSessionSnapshot(session)
  logEvent('manual_participant_added', { sessionId: session.id, pseudo })
}

// Ajustement manuel de points (+/-) pour arbitrer un détail (réponse limite,
// effort, pénalité, bonne réponse criée par un joueur sans téléphone…).
export function handleAdjustScore(
  socket: QuizSocket,
  payload: { participantId: string; delta: number },
  io: QuizServer,
): void {
  const session = getAllSessions().find((s) => s.hostSocketIds.has(socket.id))
  if (!session) return
  const p = session.participants.get(String(payload?.participantId ?? ''))
  if (!p) return
  let delta = Number(payload?.delta)
  if (!Number.isFinite(delta)) return
  delta = Math.max(-1000, Math.min(1000, Math.round(delta)))
  if (delta === 0) return
  p.score += delta
  p.bonus = (p.bonus ?? 0) + delta
  // teams_updated porte le `bonus` (écran d'ajustement, sans le score total) ;
  // leaderboard_update porte les scores réels (bouton « voir les scores » + podium).
  io.to(session.id).emit(EVENTS.TEAMS_UPDATED, getTeamsPayload(session))
  io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
    scores: getLeaderboard(session),
    final: session.status === 'ended',
  })
  saveSessionSnapshot(session)
  logEvent('score_adjusted', { sessionId: session.id, participantId: p.id, delta })
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
  session.buzz = null               // mode buzzer : plus de question active
  session.status = 'ended'
  deleteSessionSnapshot(session.id) // partie finie : plus rien à restaurer

  io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: 'ended' })
  io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
    scores: getLeaderboard(session),
    final: true,
    ...(session.mode === 'team' ? { teamScores: getTeamLeaderboard(session) } : {}),
  })
}
