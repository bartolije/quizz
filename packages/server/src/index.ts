import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_SERVER_CONFIG, EVENTS } from '@lya-quiz/shared'
import { handleJoinSession, handleRejoinSession } from './handlers/join.js'
import { handleHostJoin, handleHostStartQuiz, handleHostEndQuiz } from './handlers/host.js'
import {
  handleNextQuestion,
  handleSubmitAnswer,
  handleShowLeaderboard,
} from './handlers/game.js'
import { handleDisconnect } from './handlers/disconnect.js'
import { getAllSessions, createSession, getSessionById } from './state.js'
import { getParticipantList, getLeaderboard } from './session-helpers.js'
import type { GameReport } from '@lya-quiz/shared'
import {
  seedIfEmpty,
  listQuizzes,
  getQuiz,
  createQuiz,
  replaceQuiz,
  deleteQuiz,
  type QuizInput,
} from './quiz-repo.js'
import { logWarn, logError } from './logger.js'

// Au démarrage : crée les tables (import de db via quiz-repo) + seed si DB vide.
seedIfEmpty()

// Filets de sécurité : on logge les crashs au lieu de mourir en silence.
process.on('uncaughtException', (e) => logError('fatal_uncaught_exception', e))
process.on('unhandledRejection', (e) => logError('fatal_unhandled_rejection', e))

// Mot de passe de l'éditeur admin (à définir dans Railway via ADMIN_PASSWORD).
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? 'lyaquiz'
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    await reply.code(401).send({ error: 'unauthorized' })
  }
}

// Logger Fastify en 'warn' : évite de noyer les logs sous chaque requête HTTP
// (assets, /health…). Les événements métier passent par logEvent (info). cf. logger.ts
const app = Fastify({ logger: { level: 'warn' } })

// Socket.io partage le serveur HTTP sous-jacent de Fastify (app.server).
// app.listen() démarre les deux : routes HTTP + WebSocket sur le même port.
const io = new Server<ClientToServerEvents, ServerToClientEvents>(
  app.server,
  SOCKET_SERVER_CONFIG,
)

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
  socket.on(EVENTS.HOST_START_QUIZ, () => safe('host_start_quiz', () => handleHostStartQuiz(socket, io)))
  socket.on(EVENTS.HOST_NEXT_QUESTION, () => safe('host_next_question', () => handleNextQuestion(socket, io)))
  socket.on(EVENTS.HOST_SHOW_LEADERBOARD, () => safe('host_show_leaderboard', () => handleShowLeaderboard(socket, io)))
  socket.on(EVENTS.HOST_END_QUIZ, () => safe('host_end_quiz', () => handleHostEndQuiz(socket, io)))
  socket.on(EVENTS.SUBMIT_ANSWER, (p) => safe('submit_answer', () => handleSubmitAnswer(socket, p, io)))
  socket.on('disconnect', () => safe('disconnect', () => handleDisconnect(socket.id, io, getAllSessions)))
})

// Création d'une session (host au chargement de /host/control, ou "Lancer" depuis
// l'éditeur avec un quizId). Sans quizId → quiz par défaut.
app.post<{ Body: { quizId?: string } }>('/api/sessions', async (req) => {
  const session = createSession(req.body?.quizId)
  return { pin: session.pin, sessionId: session.id }
})

// ── Éditeur admin (protégé par mot de passe via header x-admin-password) ──
app.post('/api/admin/check', { preHandler: requireAdmin }, async () => ({ ok: true }))

app.get('/api/admin/quizzes', { preHandler: requireAdmin }, async () => listQuizzes())

app.get<{ Params: { id: string } }>(
  '/api/admin/quizzes/:id',
  { preHandler: requireAdmin },
  async (req, reply) => {
    const quiz = getQuiz(req.params.id)
    if (!quiz) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return quiz
  },
)

app.post<{ Body: QuizInput }>(
  '/api/admin/quizzes',
  { preHandler: requireAdmin },
  async (req) => ({ id: createQuiz(req.body) }),
)

app.put<{ Params: { id: string }; Body: QuizInput }>(
  '/api/admin/quizzes/:id',
  { preHandler: requireAdmin },
  async (req, reply) => {
    if (!replaceQuiz(req.params.id, req.body)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return { ok: true }
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/admin/quizzes/:id',
  { preHandler: requireAdmin },
  async (req) => {
    deleteQuiz(req.params.id)
    return { ok: true }
  },
)

// Résolution d'une session par id — sert à /host/display ouvert via ?session=XXXX
// (autre navigateur/machine, sans le PIN en localStorage). Bootstrap one-shot,
// la synchro temps réel reste 100% Socket.io.
app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
  const session = getSessionById(req.params.id)
  if (!session) {
    reply.code(404)
    return { error: 'not_found' }
  }
  return {
    pin: session.pin,
    sessionId: session.id,
    status: session.status,
    participants: getParticipantList(session),
  }
})

// Rapport de fin de partie : stats par question + classement par joueur.
app.get<{ Params: { id: string } }>('/api/sessions/:id/report', async (req, reply) => {
  const session = getSessionById(req.params.id)
  if (!session) {
    reply.code(404)
    return { error: 'not_found' }
  }
  const report: GameReport = {
    title: session.quiz?.title ?? 'Quiz',
    totalQuestions: session.results.length,
    questions: session.results,
    players: getLeaderboard(session).map((s) => ({
      participantId: s.participantId,
      pseudo: s.pseudo,
      score: s.score,
      rank: s.rank,
      correct: session.participants.get(s.participantId)?.correctTotal ?? 0,
    })),
  }
  return report
})

app.get('/health', async () => ({
  status: 'ok',
  sessions: getAllSessions().length,
  build: process.env['RAILWAY_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local',
}))

// Remontée des erreurs JS des clients (téléphones) → logs serveur (S10).
// Sinon un crash côté joueur est invisible. Payload borné, pas de log du log.
app.post<{
  Body: { level?: string; message?: string; stack?: string; context?: Record<string, unknown> }
}>('/api/client-log', async (req) => {
  const b = req.body ?? {}
  const message = String(b.message ?? '').slice(0, 500)
  if (!message) return { ok: false }
  logWarn('client_error', {
    level: b.level ?? 'error',
    message,
    stack: typeof b.stack === 'string' ? b.stack.slice(0, 2000) : undefined,
    ctx: b.context,
  })
  return { ok: true }
})

// Déploiement single-service : Fastify sert aussi le build client React.
// __dirname = packages/server/dist → le build client est à ../../client/dist
// (résolu depuis l'emplacement du fichier, indépendant du cwd de lancement).
const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist')
void app.register(fastifyStatic, {
  root: clientDist,
  wildcard: false,
  // index.html en no-cache → un nouveau déploiement est pris en compte sans
  // hard-refresh (les assets JS/CSS sont eux hashés donc immuables).
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.setHeader('cache-control', 'no-cache')
  },
})

// SPA : toute route GET non-API/non-socket renvoie index.html
// (react-router gère le routing /host/control, /join… côté client au refresh).
app.setNotFoundHandler((req, reply) => {
  const url = req.raw.url ?? ''
  if (req.method !== 'GET' || url.startsWith('/api') || url.startsWith('/socket.io')) {
    void reply.code(404).send({ error: 'not_found' })
    return
  }
  void reply.header('cache-control', 'no-cache').sendFile('index.html')
})

const PORT = Number(process.env['PORT'] ?? 3001)
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`LYA QUIZ server — ${address}`)
})
