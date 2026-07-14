import type { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { handleJoinSession, handleRejoinSession } from './handlers/join.js'
import {
  handleHostJoin,
  handleDisplayJoin,
  handleHostStartQuiz,
  handleHostEndQuiz,
  handleKickParticipant,
} from './handlers/host.js'
import {
  handleNextQuestion,
  handleReplayLastQuestion,
  handleSubmitAnswer,
  handleShowLeaderboard,
} from './handlers/game.js'
import { handleDisconnect } from './handlers/disconnect.js'
import {
  handleBuzz,
  handleAdjudicate,
  handleReopenBuzzer,
  handlePassQuestion,
  handleStartTheme,
  handleAssignOwner,
} from './handlers/buzzer.js'
import {
  handleSetMode,
  handleAddTeam,
  handleRemoveTeam,
  handleLockTeams,
  handleAssignParticipant,
  handleAutobalance,
  handleJoinTeam,
} from './handlers/team.js'
import { getAllSessions } from './state.js'
import { logError } from './logger.js'

export type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

// Câblage des handlers Socket.io — extrait de index.ts pour être branché à
// l'identique sur le serveur réel ET sur un serveur éphémère dans les tests
// d'intégration (packages/server/test).
export function attachSocketHandlers(io: QuizServer): void {
  io.on('connection', (socket) => {
    // Exécute un handler en isolant les exceptions : on logge (handler_error) et on
    // prévient le client au lieu de laisser planter le serveur.
    const safe = (event: string, fn: () => void): void => {
      try {
        fn()
      } catch (e) {
        logError('handler_error', e, { event, socketId: socket.id })
        socket.emit(EVENTS.QUIZ_ERROR, { code: 'UNKNOWN', message: 'Erreur interne du serveur.' })
      }
    }

    socket.on(EVENTS.JOIN_SESSION, (p) => safe('join_session', () => handleJoinSession(socket, p, io)))
    socket.on(EVENTS.REJOIN_SESSION, (p) => safe('rejoin_session', () => handleRejoinSession(socket, p, io)))
    socket.on(EVENTS.HOST_JOIN, (p) => safe('host_join', () => handleHostJoin(socket, p)))
    socket.on(EVENTS.DISPLAY_JOIN, (p) => safe('display_join', () => handleDisplayJoin(socket, p)))
    socket.on(EVENTS.HOST_START_QUIZ, () => safe('host_start_quiz', () => handleHostStartQuiz(socket, io)))
    socket.on(EVENTS.HOST_NEXT_QUESTION, () => safe('host_next_question', () => handleNextQuestion(socket, io)))
    socket.on(EVENTS.HOST_SHOW_LEADERBOARD, () => safe('host_show_leaderboard', () => handleShowLeaderboard(socket, io)))
    socket.on(EVENTS.HOST_END_QUIZ, () => safe('host_end_quiz', () => handleHostEndQuiz(socket, io)))
    socket.on(EVENTS.HOST_KICK_PARTICIPANT, (p) => safe('host_kick_participant', () => handleKickParticipant(socket, p, io)))
    socket.on(EVENTS.HOST_REPLAY_LAST_QUESTION, () => safe('host_replay_last_question', () => handleReplayLastQuestion(socket, io)))
    socket.on(EVENTS.SUBMIT_ANSWER, (p, ack) => safe('submit_answer', () => handleSubmitAnswer(socket, p, io, ack)))

    // Mode équipe
    socket.on(EVENTS.HOST_SET_MODE, (p) => safe('host_set_mode', () => handleSetMode(socket, p, io)))
    socket.on(EVENTS.HOST_ADD_TEAM, (p) => safe('host_add_team', () => handleAddTeam(socket, p, io)))
    socket.on(EVENTS.HOST_REMOVE_TEAM, (p) => safe('host_remove_team', () => handleRemoveTeam(socket, p, io)))
    socket.on(EVENTS.HOST_LOCK_TEAMS, (p) => safe('host_lock_teams', () => handleLockTeams(socket, p, io)))
    socket.on(EVENTS.HOST_ASSIGN_PARTICIPANT, (p) => safe('host_assign_participant', () => handleAssignParticipant(socket, p, io)))
    socket.on(EVENTS.HOST_AUTOBALANCE_TEAMS, () => safe('host_autobalance_teams', () => handleAutobalance(socket, io)))
    socket.on(EVENTS.JOIN_TEAM, (p) => safe('join_team', () => handleJoinTeam(socket, p, io)))

    // Mode buzzer (partie famille)
    socket.on(EVENTS.BUZZ, () => safe('buzz', () => handleBuzz(socket, io)))
    socket.on(EVENTS.HOST_ADJUDICATE, (p) => safe('host_adjudicate', () => handleAdjudicate(socket, p, io)))
    socket.on(EVENTS.HOST_REOPEN_BUZZER, () => safe('host_reopen_buzzer', () => handleReopenBuzzer(socket, io)))
    socket.on(EVENTS.HOST_PASS_QUESTION, () => safe('host_pass_question', () => handlePassQuestion(socket, io)))
    socket.on(EVENTS.HOST_START_THEME, (p) => safe('host_start_theme', () => handleStartTheme(socket, p, io)))
    socket.on(EVENTS.HOST_ASSIGN_OWNER, (p) => safe('host_assign_owner', () => handleAssignOwner(socket, p, io)))

    socket.on('disconnect', () => safe('disconnect', () => handleDisconnect(socket.id, io, getAllSessions)))
  })
}
