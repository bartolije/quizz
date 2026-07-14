import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS, DIFFICULTY_POINTS } from '@lya-quiz/shared'
import type { SessionState } from '../state.js'
import {
  findSessionByHostSocket,
  findParticipantBySocket,
  getLeaderboard,
  toPublicQuestion,
} from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot, deleteSessionSnapshot } from '../session-snapshot.js'

// ─────────────────────────────────────────────────────────────
// MODE BUZZER (partie famille arbitrée) — cf. .claude/plan-quiz-famille.md
//
// Rien n'est corrigé automatiquement : l'admin juge vrai/faux à l'oral. Le
// téléphone n'est qu'un BUZZER. Scoring par difficulté (Facile 1 / Moyen 2 /
// Difficile 3), même valeur pour l'owner ou le voleur, un seul gagnant/question.
//
// Machine à états d'une question (session.buzz) :
//   perso   : owner_oral ──juge faux──▶ steal(armé) …
//   culture :               steal(armé)  (ouvert à tous d'emblée)
//   steal(armé) ──buzz──▶ locked ──juge vrai──▶ revealed (le buzzeur marque)
//                                 └─juge faux──▶ steal(désarmé) + lockedOut
//   steal(désarmé) ──rouvrir──▶ steal(armé) │ ──passer──▶ revealed (0 pt)
// ─────────────────────────────────────────────────────────────

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

function broadcastBuzzState(session: SessionState, io: QuizServer): void {
  if (session.buzz) io.to(session.id).emit(EVENTS.BUZZ_STATE, session.buzz)
}

// ─────────────────────────────────────────────────────────────
// HOST : lancer la question buzzer suivante (routé depuis handleNextQuestion)
// ─────────────────────────────────────────────────────────────

export function startNextBuzzerQuestion(session: SessionState, io: QuizServer): void {
  if (!session.quiz) return
  // Une question est déjà en cours (pas encore révélée) → ne rien faire.
  if (session.buzz !== null && session.buzz.phase !== 'revealed') return

  const questions = session.quiz.questions
  const nextIndex = session.currentQuestionIndex + 1

  // Plus de questions → fin du quiz
  if (nextIndex >= questions.length) {
    session.status = 'ended'
    session.buzz = null
    deleteSessionSnapshot(session.id)
    io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: 'ended' })
    io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
      scores: getLeaderboard(session),
      final: true,
    })
    logEvent('quiz_ended', { sessionId: session.id, questions: questions.length })
    return
  }

  const q = questions[nextIndex]
  if (!q) return

  session.currentQuestionIndex = nextIndex
  session.lastQuestionResults = null
  session.lastCorrectAnswers = null

  // 'perso' → l'owner répond d'abord à l'oral (buzzer désarmé). 'culture' (ou
  // section absente) → buzzer ouvert à tous immédiatement.
  const isPerso = q.section === 'perso'
  const ownerName = isPerso ? (q.ownerName ?? null) : null
  const ownerParticipantId =
    ownerName !== null ? (session.ownerBindings.get(ownerName) ?? null) : null

  session.buzz = isPerso
    ? { phase: 'owner_oral', armed: false, ownerName, ownerParticipantId, lockedBy: null, lockedOut: [] }
    : { phase: 'steal', armed: true, ownerName: null, ownerParticipantId: null, lockedBy: null, lockedOut: [] }

  saveSessionSnapshot(session)

  io.to(session.id).emit(EVENTS.BUZZ_QUESTION_STARTED, {
    question: toPublicQuestion(q, nextIndex, questions.length),
    buzz: session.buzz,
  })
  logEvent('buzz_question_started', {
    sessionId: session.id,
    questionIndex: nextIndex,
    section: q.section ?? 'culture',
    difficulty: q.difficulty ?? null,
  })
}

// ─────────────────────────────────────────────────────────────
// PARTICIPANT : buzzer (le 1er reçu gagne — single-threaded, pas de race)
// ─────────────────────────────────────────────────────────────

export function handleBuzz(socket: QuizSocket, io: QuizServer): void {
  const ctx = findParticipantBySocket(socket.id)
  if (!ctx) return
  const { session, participant } = ctx
  const b = session.buzz
  if (!b || !b.armed) return                         // buzzer non armé → ignoré
  if (b.ownerParticipantId === participant.id) return // l'owner ne vole pas son propre thème
  if (b.lockedOut.includes(participant.id)) return    // a déjà tenté cette question

  b.armed = false
  b.phase = 'locked'
  b.lockedBy = { participantId: participant.id, pseudo: participant.pseudo }
  broadcastBuzzState(session, io)
  logEvent('buzz', { sessionId: session.id, participantId: participant.id })
}

// ─────────────────────────────────────────────────────────────
// HOST : arbitrage vrai/faux du locuteur courant (owner ou buzzeur)
// ─────────────────────────────────────────────────────────────

export function handleAdjudicate(
  socket: QuizSocket,
  payload: { correct: boolean },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || !session.buzz) return
  const b = session.buzz
  const correct = payload?.correct === true

  if (b.phase === 'owner_oral') {
    if (correct) {
      awardAndReveal(session, io, b.ownerParticipantId)
    } else {
      // L'owner a séché → ouverture du vol (buzzer armé pour tous sauf lui).
      b.phase = 'steal'
      b.armed = true
      broadcastBuzzState(session, io)
      logEvent('buzz_owner_missed', { sessionId: session.id, questionIndex: session.currentQuestionIndex })
    }
    return
  }

  if (b.phase === 'locked') {
    const stealerId = b.lockedBy?.participantId ?? null
    if (correct) {
      awardAndReveal(session, io, stealerId)
    } else {
      // Vol raté : le buzzeur est bloqué, on attend « rouvrir » ou « passer ».
      if (stealerId !== null) b.lockedOut.push(stealerId)
      b.lockedBy = null
      b.phase = 'steal'
      b.armed = false
      broadcastBuzzState(session, io)
      logEvent('buzz_steal_missed', { sessionId: session.id, participantId: stealerId })
    }
    return
  }
  // Autres phases (idle/revealed) : rien à arbitrer.
}

// ─────────────────────────────────────────────────────────────
// HOST : rouvrir le buzzer après un vol raté / passer (personne ne trouve)
// ─────────────────────────────────────────────────────────────

export function handleReopenBuzzer(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || !session.buzz) return
  const b = session.buzz
  if (b.phase !== 'steal' || b.armed) return // rien à rouvrir hors d'un vol désarmé
  b.armed = true
  broadcastBuzzState(session, io)
  logEvent('buzz_reopened', { sessionId: session.id, questionIndex: session.currentQuestionIndex })
}

export function handlePassQuestion(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || !session.buzz) return
  if (session.buzz.phase === 'revealed') return
  awardAndReveal(session, io, null) // personne ne marque
}

// ─────────────────────────────────────────────────────────────
// Fermeture d'une question : attribution des points + révélation
// ─────────────────────────────────────────────────────────────

function awardAndReveal(session: SessionState, io: QuizServer, scorerId: string | null): void {
  const b = session.buzz
  const q = session.quiz?.questions[session.currentQuestionIndex]
  if (!b || !q) return

  const difficulty = q.difficulty ?? null
  const points = difficulty ? DIFFICULTY_POINTS[difficulty] : 0

  // Reset des deltas (comme la fermeture d'une question classique)
  for (const p of session.participants.values()) p.lastDelta = 0

  let scorer: { participantId: string; pseudo: string; points: number } | null = null
  if (scorerId !== null) {
    const p = session.participants.get(scorerId)
    if (p) {
      p.score += points
      p.lastDelta = points
      p.correctTotal += 1
      scorer = { participantId: p.id, pseudo: p.pseudo, points }
    }
  }

  b.phase = 'revealed'
  b.armed = false
  b.lockedBy = null

  // Historise la question pour le rapport de fin de partie
  session.results.push({
    index: session.currentQuestionIndex,
    text: q.text,
    type: q.type,
    correctAnswers: q.correctAnswers,
    answeredCount: scorer ? 1 : 0,
    correctCount: scorer ? 1 : 0,
  })
  session.lastCorrectAnswers = q.correctAnswers

  const scores = getLeaderboard(session)
  io.to(session.id).emit(EVENTS.BUZZ_QUESTION_ENDED, {
    correctAnswers: q.correctAnswers,
    difficulty,
    scorer,
    scores,
  })
  broadcastBuzzState(session, io) // phase 'revealed'
  saveSessionSnapshot(session)
  logEvent('buzz_question_ended', {
    sessionId: session.id,
    questionIndex: session.currentQuestionIndex,
    scorer: scorerId,
    points,
  })
}
