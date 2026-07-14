import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents, BuzzThemesState } from '@lya-quiz/shared'
import { EVENTS, CULTURE_THEME, questionPoints } from '@lya-quiz/shared'
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
// Thèmes (round perso) : sélection + progression
// ─────────────────────────────────────────────────────────────

// Index des questions du quiz appartenant à un thème (dans l'ordre du quiz).
// CULTURE_THEME = toutes les questions non-'perso' (culture ou section absente).
function themeIndices(session: SessionState, theme: string): number[] {
  const qs = session.quiz?.questions ?? []
  const out: number[] = []
  qs.forEach((q, i) => {
    if (theme === CULTURE_THEME) {
      if (q.section !== 'perso') out.push(i)
    } else if (q.section === 'perso' && q.ownerName === theme) {
      out.push(i)
    }
  })
  return out
}

// Première question non encore jouée du thème (null si le thème est fini).
function nextUnplayedInTheme(session: SessionState, theme: string): number | null {
  for (const i of themeIndices(session, theme)) {
    if (!session.playedQuestionIndices.has(i)) return i
  }
  return null
}

// Noms des thèmes perso, dans l'ordre de première apparition dans le quiz.
function distinctOwners(session: SessionState): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const q of session.quiz?.questions ?? []) {
    if (q.section === 'perso' && q.ownerName && !seen.has(q.ownerName)) {
      seen.add(q.ownerName)
      out.push(q.ownerName)
    }
  }
  return out
}

function allPlayed(session: SessionState): boolean {
  const n = session.quiz?.questions.length ?? 0
  for (let i = 0; i < n; i++) if (!session.playedQuestionIndices.has(i)) return false
  return true
}

export function buildThemes(session: SessionState): BuzzThemesState {
  const owners = distinctOwners(session).map((ownerName) => {
    const idxs = themeIndices(session, ownerName)
    return {
      ownerName,
      participantId: session.ownerBindings.get(ownerName) ?? null,
      total: idxs.length,
      done: idxs.length > 0 && idxs.every((i) => session.playedQuestionIndices.has(i)),
    }
  })
  const cultureIdxs = themeIndices(session, CULTURE_THEME)
  return {
    owners,
    culture: {
      total: cultureIdxs.length,
      done: cultureIdxs.length > 0 && cultureIdxs.every((i) => session.playedQuestionIndices.has(i)),
    },
    currentTheme: session.currentTheme,
  }
}

export function broadcastThemes(session: SessionState, io: QuizServer): void {
  io.to(session.id).emit(EVENTS.BUZZ_THEMES, buildThemes(session))
}

// ─────────────────────────────────────────────────────────────
// HOST : lancer la question buzzer suivante (routé depuis handleNextQuestion)
// ─────────────────────────────────────────────────────────────

function finishQuiz(session: SessionState, io: QuizServer): void {
  session.status = 'ended'
  session.buzz = null
  session.currentTheme = null
  deleteSessionSnapshot(session.id)
  io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: 'ended' })
  io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, { scores: getLeaderboard(session), final: true })
  logEvent('quiz_ended', { sessionId: session.id })
}

// Démarre la question à l'index donné : owner_oral si 'perso' (l'owner répond
// d'abord à l'oral, buzzer désarmé), steal armé sinon (culture, ouvert à tous).
function startBuzzerQuestionAt(session: SessionState, io: QuizServer, index: number): void {
  const questions = session.quiz?.questions ?? []
  const q = questions[index]
  if (!q) return

  session.currentQuestionIndex = index
  session.lastQuestionResults = null
  session.lastCorrectAnswers = null

  const isPerso = q.section === 'perso'
  const ownerName = isPerso ? (q.ownerName ?? null) : null
  const ownerParticipantId =
    ownerName !== null ? (session.ownerBindings.get(ownerName) ?? null) : null

  session.buzz = isPerso
    ? { phase: 'owner_oral', armed: false, ownerName, ownerParticipantId, lockedBy: null, lockedOut: [] }
    : { phase: 'steal', armed: true, ownerName: null, ownerParticipantId: null, lockedBy: null, lockedOut: [] }

  saveSessionSnapshot(session)
  io.to(session.id).emit(EVENTS.BUZZ_QUESTION_STARTED, {
    question: toPublicQuestion(q, index, questions.length),
    buzz: session.buzz,
  })
  logEvent('buzz_question_started', {
    sessionId: session.id,
    questionIndex: index,
    section: q.section ?? 'culture',
    difficulty: q.difficulty ?? null,
  })
}

// host_next_question (mode buzzer) : question suivante DANS le thème courant.
// Un quiz 100% culture n'a pas de sélection de thème → auto-thème culture, ce qui
// préserve le flux « Lancer une question » du round culture (Phase 1).
export function startNextBuzzerQuestion(session: SessionState, io: QuizServer): void {
  if (!session.quiz) return
  if (session.buzz !== null && session.buzz.phase !== 'revealed') return // question en cours

  if (session.currentTheme === null && distinctOwners(session).length === 0) {
    session.currentTheme = CULTURE_THEME
  }
  if (session.currentTheme === null) return // le host doit choisir un thème (UI = sélecteur)

  const idx = nextUnplayedInTheme(session, session.currentTheme)
  if (idx !== null) {
    startBuzzerQuestionAt(session, io, idx)
    broadcastThemes(session, io)
    return
  }

  // Thème terminé → fin de partie si tout est joué, sinon retour au sélecteur.
  session.buzz = null
  if (allPlayed(session)) {
    finishQuiz(session, io)
    return
  }
  session.currentTheme = null
  broadcastThemes(session, io)
}

// host_start_theme : l'admin choisit le thème (joueur) ou la culture G à jouer.
export function handleStartTheme(
  socket: QuizSocket,
  payload: { ownerName: string },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || !session.quiz) return
  if (session.buzz !== null && session.buzz.phase !== 'revealed') return // une question est en cours

  const theme = String(payload?.ownerName ?? '')
  const idx = nextUnplayedInTheme(session, theme)
  if (idx === null) {
    // Thème déjà fini / inconnu → retour sélecteur.
    session.buzz = null
    session.currentTheme = null
    broadcastThemes(session, io)
    return
  }
  session.currentTheme = theme
  startBuzzerQuestionAt(session, io, idx)
  broadcastThemes(session, io)
  logEvent('buzz_theme_started', { sessionId: session.id, theme })
}

// host_assign_owner : associer un slot de thème (ownerName) à un participant.
export function handleAssignOwner(
  socket: QuizSocket,
  payload: { ownerName: string; participantId: string | null },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  const ownerName = String(payload?.ownerName ?? '')
  if (!ownerName) return
  const pid = payload?.participantId ?? null
  if (pid === null) {
    session.ownerBindings.delete(ownerName)
  } else {
    // Un joueur ne possède qu'UN thème : on retire ses éventuels autres bindings.
    for (const [k, v] of session.ownerBindings) if (v === pid) session.ownerBindings.delete(k)
    session.ownerBindings.set(ownerName, pid)
  }
  // Question de ce thème en cours (owner_oral) → re-résoudre l'owner à chaud.
  if (session.buzz && session.buzz.phase === 'owner_oral' && session.buzz.ownerName === ownerName) {
    session.buzz.ownerParticipantId = session.ownerBindings.get(ownerName) ?? null
    broadcastBuzzState(session, io)
  }
  saveSessionSnapshot(session)
  broadcastThemes(session, io)
  logEvent('buzz_owner_assigned', { sessionId: session.id, ownerName, participantId: pid })
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
  const points = questionPoints(q)

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
  session.playedQuestionIndices.add(session.currentQuestionIndex) // question jouée

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
  broadcastThemes(session, io)    // progression du thème mise à jour (question jouée)
  saveSessionSnapshot(session)
  logEvent('buzz_question_ended', {
    sessionId: session.id,
    questionIndex: session.currentQuestionIndex,
    scorer: scorerId,
    points,
  })
}
