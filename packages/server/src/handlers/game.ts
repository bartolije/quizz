import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents, SubmitAnswerAck } from '@lya-quiz/shared'
import {
  EVENTS,
  calculateScore,
  calculateClosestScore,
  computeClosestScale,
  isCorrectFreeAnswer,
} from '@lya-quiz/shared'
import { getAllSessions, type SessionState } from '../state.js'
import { getLeaderboard, getTeamLeaderboard, toPublicQuestion } from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot, deleteSessionSnapshot } from '../session-snapshot.js'
import { startNextBuzzerQuestion } from './buzzer.js'

// Champ teamScores des payloads (présent uniquement en mode équipe).
// exactOptionalPropertyTypes : on spread {} en solo plutôt que teamScores:undefined.
function teamScoresField(session: SessionState): { teamScores: ReturnType<typeof getTeamLeaderboard> } | Record<string, never> {
  return session.mode === 'team' ? { teamScores: getTeamLeaderboard(session) } : {}
}

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

// Fenêtre de grâce pour la fermeture anticipée « tous ont répondu » : un joueur
// déconnecté depuis moins de GRACE compte encore dans le dénominateur — sinon un
// simple blip pendant que les autres répondent fermait la question sous ses pieds
// pendant qu'il rechargeait. Au pire, le timer serveur borne l'attente.
const DISCONNECT_GRACE_MS = 30_000

function eligibleParticipants(session: SessionState) {
  const now = Date.now()
  return [...session.participants.values()].filter(
    (p) => p.connected || (p.disconnectedAt !== undefined && now - p.disconnectedAt < DISCONNECT_GRACE_MS),
  )
}

// Mélange (Fisher-Yates) en garantissant un ordre différent de l'original.
function shuffleDistinct(items: string[]): string[] {
  if (items.length < 2) return [...items]
  let out = [...items]
  for (let attempt = 0; attempt < 6; attempt++) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    if (out.some((v, i) => v !== items[i])) return out // au moins un item déplacé
    out = [...items]
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// HOST : lancer la question suivante (ou terminer le quiz)
// ─────────────────────────────────────────────────────────────

export function handleNextQuestion(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  // Partie famille : la question suivante suit la machine à états buzzer.
  if (session.quiz?.gameType === 'buzzer') {
    startNextBuzzerQuestion(session, io)
    return
  }
  startNextQuestion(session, io)
}

// Cœur du lancement de question — appelé par handleNextQuestion (host) et par
// handleReplayLastQuestion (relance immédiate après annulation).
function startNextQuestion(session: SessionState, io: QuizServer): void {
  if (!session.quiz) return
  if (session.questionStartedAt !== null) return // une question est déjà ouverte

  const questions = session.quiz.questions
  const nextIndex = session.currentQuestionIndex + 1

  // Plus de questions → fin du quiz
  if (nextIndex >= questions.length) {
    session.status = 'ended'
    deleteSessionSnapshot(session.id) // partie finie : plus rien à restaurer
    io.to(session.id).emit(EVENTS.SESSION_STATUS_CHANGED, { status: 'ended' })
    io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
      scores: getLeaderboard(session),
      final: true,
      ...teamScoresField(session),
    })
    logEvent('quiz_ended', { sessionId: session.id, questions: questions.length })
    return
  }

  const q = questions[nextIndex]
  if (!q) return

  session.currentQuestionIndex = nextIndex
  session.answers.clear()
  session.lastQuestionResults = null
  session.lastCorrectAnswers = null
  session.questionStartedAt = Date.now()
  // 'ordering' : items mélangés une fois (même mélange pour tous + reconnexion cohérente)
  session.currentShuffled = q.type === 'ordering' ? shuffleDistinct(q.correctAnswers) : null

  // Fermeture automatique à la fin du temps imparti
  session.questionTimer = setTimeout(() => {
    closeQuestion(session, io, 'timer')
  }, q.timeLimit * 1000)

  saveSessionSnapshot(session) // un restart pendant la question la rejouera

  io.to(session.id).emit(EVENTS.QUESTION_STARTED, {
    question: toPublicQuestion(q, nextIndex, questions.length, session.currentShuffled ?? undefined),
    startedAt: session.questionStartedAt,
    timeElapsed: 0,
  })
  logEvent('question_started', {
    sessionId: session.id,
    questionIndex: nextIndex,
    type: q.type,
    timeLimit: q.timeLimit,
  })
}

// ─────────────────────────────────────────────────────────────
// HOST : rejouer la dernière question fermée (filet anti-fausse-manip)
// ─────────────────────────────────────────────────────────────

export function handleReplayLastQuestion(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || !session.quiz) return
  if (session.status !== 'running') return
  if (session.questionStartedAt !== null) return   // pas pendant une question ouverte
  if (session.currentQuestionIndex < 0) return
  // Rien à annuler (ex : reprise post-restart, la question interrompue n'a
  // jamais été fermée → il suffit de faire « question suivante »).
  if (!session.lastQuestionResults) return

  // Reprendre les points accordés à la fermeture de cette question
  for (const [pid, r] of session.lastQuestionResults) {
    const p = session.participants.get(pid)
    if (!p) continue
    p.score -= r.gained
    if (r.correct) p.correctTotal = Math.max(0, p.correctTotal - 1)
    p.lastDelta = 0
  }
  session.results.pop() // retire l'entrée du rapport de fin
  session.lastQuestionResults = null
  session.lastCorrectAnswers = null
  session.answers.clear()
  session.currentQuestionIndex -= 1

  logEvent('question_replayed', {
    sessionId: session.id,
    questionIndex: session.currentQuestionIndex + 1,
  })

  // Relance immédiate de la même question (état neuf pour tout le monde)
  startNextQuestion(session, io)
}

// ─────────────────────────────────────────────────────────────
// PARTICIPANT : soumettre une réponse
// ─────────────────────────────────────────────────────────────

// Bornes serveur : une réponse vient d'un client non fiable. Sans elles, une
// string de 1 Mo passait telle quelle dans le Levenshtein (synchrone, plein-
// matrice) au moment du scoring → event loop bloquée pour toute la salle.
const ANSWER_MAX_LEN = 200
const ORDERING_MAX_ITEMS = 30

function sanitizeAnswer(v: unknown): string | number | string[] | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return v.slice(0, ANSWER_MAX_LEN)
  if (Array.isArray(v)) {
    if (v.length > ORDERING_MAX_ITEMS) return null
    if (!v.every((x): x is string => typeof x === 'string' && x.length <= ANSWER_MAX_LEN)) return null
    return v
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// HOST : afficher le classement intermédiaire (entre deux questions)
// ─────────────────────────────────────────────────────────────

export function handleShowLeaderboard(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  io.to(session.id).emit(EVENTS.LEADERBOARD_UPDATE, {
    scores: getLeaderboard(session),
    final: false,
    ...teamScoresField(session),
  })
}

export function handleSubmitAnswer(
  socket: QuizSocket,
  payload: { answer: string | number | string[]; questionIndex: number },
  io: QuizServer,
  ack?: (res: SubmitAnswerAck) => void,
): void {
  // L'ack vient du client (non fiable) : on le garde optionnel et typé défensif.
  const respond = (res: SubmitAnswerAck): void => {
    if (typeof ack === 'function') ack(res)
  }

  const ctx = findParticipantContext(socket.id)
  if (!ctx) {
    // socket pas (encore) rattaché à un participant — ex. réponse rejouée par le
    // buffer Socket.io AVANT que rejoin_session ait réassocié le nouveau socket.
    // Le client retente après le rejoin.
    respond({ ok: false, status: 'not_in_session' })
    return
  }
  const { session, participantId } = ctx

  // Question fermée OU réponse retardée visant une autre question que l'actuelle
  // (buffer rejoué après le passage à la question suivante) → refus explicite.
  if (session.questionStartedAt === null || payload.questionIndex !== session.currentQuestionIndex) {
    respond({ ok: false, status: 'question_closed' })
    return
  }
  if (session.answers.has(participantId)) {
    // Déjà répondu (la 1ʳᵉ réponse compte) — succès du point de vue du client :
    // sa réponse est bien enregistrée (cas du retry après coupure).
    respond({ ok: true, status: 'already_answered' })
    return
  }

  const answer = sanitizeAnswer(payload?.answer)
  if (answer === null) {
    respond({ ok: false, status: 'invalid_answer' })
    return
  }

  session.answers.set(participantId, {
    value: answer,
    submittedAt: Date.now(),
  })
  respond({ ok: true, status: 'accepted' })

  const participant = session.participants.get(participantId)
  const eligible = eligibleParticipants(session)

  // Compteur live pour le host
  io.to(`host:${session.id}`).emit(EVENTS.ANSWER_RECEIVED, {
    participantId,
    pseudo: participant?.pseudo ?? '',
    answeredCount: session.answers.size,
    totalCount: eligible.length,
  })

  // Fin anticipée : tous les participants « éligibles » ont répondu (connectés
  // + déconnectés récents en fenêtre de grâce, cf. eligibleParticipants)
  if (eligible.length > 0 && session.answers.size >= eligible.length) {
    closeQuestion(session, io, 'all_answered')
  }
}

// ─────────────────────────────────────────────────────────────
// Fermeture d'une question : scoring + révélation
// ─────────────────────────────────────────────────────────────

export function closeQuestion(
  session: SessionState,
  io: QuizServer,
  reason: 'timer' | 'all_answered' = 'timer',
): void {
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
  const toNum = (v: string | number | string[]): number | null => {
    if (Array.isArray(v)) return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim())
    return Number.isFinite(n) ? n : null
  }

  // 'closest' : pré-calcul de la valeur cible + échelle ROBUSTE (percentile des
  // écarts — une réponse absurde n'écrase plus le barème, cf. computeClosestScale).
  let correctNum = 0
  let maxDeviation = 0
  if (q.type === 'closest') {
    correctNum = Number(q.correctAnswers[0])
    const deviations: number[] = []
    for (const ans of session.answers.values()) {
      const n = toNum(ans.value)
      if (n !== null) deviations.push(Math.abs(correctNum - n))
    }
    maxDeviation = computeClosestScale(deviations)
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
    } else if (q.type === 'ordering') {
      // partiel : ratio d'items à la bonne position × score de vitesse
      const submitted = Array.isArray(ans.value) ? ans.value : []
      const order = q.correctAnswers
      const placed = order.filter((v, idx) => submitted[idx] === v).length
      const ratio = order.length > 0 ? placed / order.length : 0
      gained = Math.round(calculateScore(q.timeLimit, elapsed) * ratio)
      correct = ratio === 1
    } else {
      // closest : tout le monde marque selon la distance (pas de bonus vitesse)
      const n = toNum(ans.value)
      gained = n === null ? 0 : calculateClosestScore(correctNum, n, maxDeviation)
    }

    p.lastDelta = gained
    p.score += gained
    if (correct) p.correctTotal += 1
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

  // Mémorise le résultat individuel pour la reprise entre deux questions
  // (session_restored.lastResult, cf. join.ts)
  session.lastQuestionResults = results
  session.lastCorrectAnswers = q.correctAnswers

  const scores = getLeaderboard(session)
  const teamField = teamScoresField(session)
  const answeredCount = session.answers.size
  const correctCount = [...results.values()].filter((r) => r.correct).length

  // Historise la question pour le rapport de fin de partie
  session.results.push({
    index: session.currentQuestionIndex,
    text: q.text,
    type: q.type,
    correctAnswers: q.correctAnswers,
    answeredCount,
    correctCount,
  })

  // question_ended est personnalisé (myAnswer/myCorrect/myScore/myDelta) → emit par socket
  for (const p of session.participants.values()) {
    if (!p.connected) continue
    const ans = session.answers.get(p.id)
    io.to(p.socketId).emit(EVENTS.QUESTION_ENDED, {
      correctAnswers: q.correctAnswers,
      scores,
      distribution,
      answeredCount,
      correctCount,
      myAnswer: ans?.value ?? null,
      myCorrect: results.get(p.id)?.correct ?? false,
      myScore: p.score,
      myDelta: p.lastDelta,
      ...teamField,
    })
  }

  // Vue host (pas de "my"). nextMediaUrl : la TV précharge l'image de la
  // prochaine question pendant la révélation (jamais envoyé aux participants).
  const nextMediaUrl = quiz.questions[session.currentQuestionIndex + 1]?.mediaUrl
  io.to(`host:${session.id}`).emit(EVENTS.QUESTION_ENDED, {
    correctAnswers: q.correctAnswers,
    scores,
    distribution,
    answeredCount,
    correctCount,
    myAnswer: null,
    myCorrect: false,
    myScore: 0,
    myDelta: 0,
    ...teamField,
    ...(nextMediaUrl ? { nextMediaUrl } : {}),
  })

  logEvent('question_closed', {
    sessionId: session.id,
    questionIndex: session.currentQuestionIndex,
    type: q.type,
    answeredCount,
    correctCount,
    closeReason: reason,
  })

  saveSessionSnapshot(session) // scores figés → snapshot à jour pour un restart
}
